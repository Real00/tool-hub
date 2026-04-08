<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
  abortSystemRecorder,
  appendSystemRecorderChunk,
  finishSystemRecorder,
  getSystemAppsByIds,
  getSystemRecorderState,
  isElectronRuntime,
  listSystemRecorderSources,
  pickSystemRecorderFfmpegPath,
  prepareSystemRecorderPreview,
  setSystemRecorderFfmpegPath,
  startSystemRecorder,
} from "../../platform/electron-bridge";
import type {
  SystemAppEntry,
  SystemRecorderSource,
  SystemRecorderSourceKind,
  SystemRecorderState,
} from "../../types/system-app";

interface ResolutionPreset {
  id: string;
  label: string;
  width: number | null;
  height: number | null;
}

const RECORDER_APP_IDS = ["builtin:screen-recorder", "builtin:window-recorder"] as const;
const canUseSystemRecorder = isElectronRuntime();
const RECORDING_TIMESLICE_MS = 1000;
const RECORDER_MIME_TYPES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];
const FRAME_RATE_OPTIONS = [60, 30, 24, 15];
const RESOLUTION_PRESETS: ResolutionPreset[] = [
  { id: "native", label: "原始分辨率", width: null, height: null },
  { id: "1080p", label: "1920 x 1080", width: 1920, height: 1080 },
  { id: "900p", label: "1600 x 900", width: 1600, height: 900 },
  { id: "720p", label: "1280 x 720", width: 1280, height: 720 },
  { id: "480p", label: "854 x 480", width: 854, height: 480 },
];

const route = useRoute();
const panelRef = ref<HTMLElement | null>(null);
const previewVideoRef = ref<HTMLVideoElement | null>(null);
const previewActive = ref(false);
const systemApps = ref<SystemAppEntry[]>([]);
const recorderState = ref<SystemRecorderState>({
  available: false,
  recording: false,
  transcoding: false,
  mode: null,
  sourceId: null,
  sourceName: null,
  outputPath: null,
  startedAt: null,
  lastError: null,
});
const sourceOptions = ref<SystemRecorderSource[]>([]);
const sourceOptionsByMode = ref<Record<SystemRecorderSourceKind, SystemRecorderSource[]>>({
  screen: [],
  window: [],
});
const actionStatus = ref<"idle" | "loading" | "success" | "error">("idle");
const actionMessage = ref("系统录像使用 Electron 官方 desktopCapturer 和浏览器 MediaRecorder。");
const activeSystemAppId = ref<string>(RECORDER_APP_IDS[0]);
const selectedSourceIds = ref<Record<SystemRecorderSourceKind, string>>({
  screen: "",
  window: "",
});
const recordingMimeType = ref("");
const selectedFrameRate = ref(30);
const selectedResolutionId = ref("native");
const captureAudioEnabled = ref(false);
const transcodeToMp4Enabled = ref(false);
const ffmpegPathDraft = ref("");
const ffmpegPathDirty = ref(false);
const outputWidth = ref<number | null>(null);
const outputHeight = ref<number | null>(null);
const audioTrackAvailable = ref(false);

let statePollingTimer: ReturnType<typeof setInterval> | null = null;
let sourceRequestToken = 0;
let previewRequestToken = 0;
let previewTask: Promise<void> | null = null;
let previewPaused = false;
let previewMediaStream: MediaStream | null = null;
let sourceMediaStream: MediaStream | null = null;
let recorderMediaStream: MediaStream | null = null;
let canvasMediaStream: MediaStream | null = null;
let mediaRecorder: MediaRecorder | null = null;
let renderVideoElement: HTMLVideoElement | null = null;
let renderCanvasElement: HTMLCanvasElement | null = null;
let renderIntervalId: ReturnType<typeof setInterval> | null = null;
let activeSessionId = "";
let chunkWriteChain = Promise.resolve();
let stopRecordingPromise: Promise<void> | null = null;
let stopRecordingRequested = false;

const activeMode = computed<SystemRecorderSourceKind>(() => {
  return activeSystemAppId.value === "builtin:window-recorder" ? "window" : "screen";
});

const activeSystemApp = computed(() => {
  return systemApps.value.find((item) => item.id === activeSystemAppId.value) ?? null;
});

const activeSourceId = computed({
  get() {
    return selectedSourceIds.value[activeMode.value] || "";
  },
  set(value: string) {
    selectedSourceIds.value = {
      ...selectedSourceIds.value,
      [activeMode.value]: value,
    };
  },
});

const selectedSource = computed(() => {
  return sourceOptions.value.find((item) => item.id === activeSourceId.value) ?? null;
});

const selectedResolutionPreset = computed(() => {
  return RESOLUTION_PRESETS.find((item) => item.id === selectedResolutionId.value) ?? RESOLUTION_PRESETS[0];
});
const transcodeProgressPercent = computed(() => {
  const percent = Number(recorderState.value.transcodeProgressPercent ?? null);
  if (!Number.isFinite(percent)) {
    return null;
  }
  return Math.max(0, Math.min(100, percent));
});

const activeRecordingLabel = computed(() => {
  if (!recorderState.value.recording || !recorderState.value.mode || !recorderState.value.sourceName) {
    return "";
  }
  const label = recorderState.value.mode === "window" ? "应用录像" : "屏幕录像";
  return `${label}中: ${recorderState.value.sourceName}`;
});

const outputPathLabel = computed(() => recorderState.value.outputPath || "尚未生成输出文件");
const currentStartedAtLabel = computed(() => {
  if (!recorderState.value.startedAt) {
    return "";
  }
  return new Date(recorderState.value.startedAt).toLocaleString();
});
const outputResolutionLabel = computed(() => {
  if (!outputWidth.value || !outputHeight.value) {
    return selectedResolutionPreset.value.label;
  }
  return `${outputWidth.value} x ${outputHeight.value}`;
});

function pickRecorderMimeType(): string {
  for (let i = 0; i < RECORDER_MIME_TYPES.length; i += 1) {
    const mimeType = RECORDER_MIME_TYPES[i];
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }
  return "";
}

function stopRenderPipeline() {
  if (renderIntervalId) {
    clearInterval(renderIntervalId);
    renderIntervalId = null;
  }
  if (renderVideoElement) {
    try {
      renderVideoElement.pause();
    } catch {
      // Ignore pause failures during cleanup.
    }
    renderVideoElement.srcObject = null;
    renderVideoElement = null;
  }
  if (renderCanvasElement) {
    renderCanvasElement.width = 0;
    renderCanvasElement.height = 0;
    renderCanvasElement = null;
  }
  if (canvasMediaStream) {
    canvasMediaStream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        // Ignore track stop failures during cleanup.
      }
    });
    canvasMediaStream = null;
  }
}

function stopMediaTracks() {
  if (previewMediaStream) {
    previewMediaStream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        // Ignore preview track stop failures during cleanup.
      }
    });
    previewMediaStream = null;
  }
  if (previewVideoRef.value) {
    previewVideoRef.value.srcObject = null;
  }
  previewActive.value = false;
  stopRenderPipeline();
  if (recorderMediaStream) {
    recorderMediaStream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        // Ignore track stop failures during cleanup.
      }
    });
    recorderMediaStream = null;
  }
  if (sourceMediaStream) {
    sourceMediaStream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        // Ignore track stop failures during cleanup.
      }
    });
    sourceMediaStream = null;
  }
}

async function restartPreviewStream() {
  if (!canUseSystemRecorder || previewPaused || !activeSourceId.value || recorderState.value.recording) {
    if (previewMediaStream) {
      previewMediaStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignore preview track stop failures during cleanup.
        }
      });
      previewMediaStream = null;
    }
    if (previewVideoRef.value) {
      previewVideoRef.value.srcObject = null;
    }
    return;
  }

  const requestToken = ++previewRequestToken;
  if (previewMediaStream) {
    previewMediaStream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        // Ignore preview track stop failures during cleanup.
      }
    });
    previewMediaStream = null;
  }
  if (previewVideoRef.value) {
    previewVideoRef.value.srcObject = null;
  }

  try {
    await prepareSystemRecorderPreview({
      mode: activeMode.value,
      sourceId: activeSourceId.value,
    });
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });
    if (requestToken !== previewRequestToken) {
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignore stale preview stream cleanup errors.
        }
      });
      return;
    }
    previewMediaStream = stream;
    if (previewVideoRef.value) {
      previewVideoRef.value.srcObject = stream;
      previewActive.value = true;
      try {
        await previewVideoRef.value.play();
      } catch {
        // Ignore autoplay failures for preview.
      }
    }
  } catch {
    if (requestToken !== previewRequestToken) {
      return;
    }
    if (previewVideoRef.value) {
      previewVideoRef.value.srcObject = null;
    }
    previewActive.value = false;
  }
}

function queuePreviewRestart() {
  previewTask = restartPreviewStream()
    .catch(() => {})
    .finally(() => {
      previewTask = null;
    });
  return previewTask;
}

function resetOutputInfo() {
  recordingMimeType.value = "";
  outputWidth.value = null;
  outputHeight.value = null;
  audioTrackAvailable.value = false;
}

async function loadSystemApps() {
  if (!canUseSystemRecorder) {
    systemApps.value = [];
    return;
  }
  try {
    const entries = await getSystemAppsByIds([...RECORDER_APP_IDS]);
    systemApps.value = RECORDER_APP_IDS
      .map((id) => entries.find((item) => item.id === id))
      .filter((item): item is SystemAppEntry => Boolean(item));
  } catch (error) {
    actionStatus.value = "error";
    actionMessage.value = error instanceof Error ? error.message : String(error);
  }
}

async function loadRecorderState(options: { syncDraft?: boolean } = {}) {
  if (!canUseSystemRecorder) {
    return;
  }
  try {
    recorderState.value = await getSystemRecorderState();
    if (options.syncDraft === true || !ffmpegPathDirty.value) {
      ffmpegPathDraft.value =
        recorderState.value.ffmpegConfiguredPath || recorderState.value.ffmpegResolvedPath || "";
      ffmpegPathDirty.value = false;
    }
  } catch (error) {
    actionStatus.value = "error";
    actionMessage.value = error instanceof Error ? error.message : String(error);
  }
}

function ensureSourceSelection(mode: SystemRecorderSourceKind, sources: SystemRecorderSource[]) {
  const currentId = selectedSourceIds.value[mode];
  if (currentId && sources.some((item) => item.id === currentId)) {
    return;
  }
  selectedSourceIds.value = {
    ...selectedSourceIds.value,
    [mode]: sources[0]?.id ?? "",
  };
}

async function loadSources(mode: SystemRecorderSourceKind) {
  if (!canUseSystemRecorder) {
    sourceOptions.value = [];
    return;
  }
  const requestToken = ++sourceRequestToken;
  const shouldUpdateStatus = !recorderState.value.recording && !recorderState.value.transcoding;
  if (shouldUpdateStatus) {
    actionStatus.value = "loading";
  }
  try {
    const sources = await listSystemRecorderSources(mode);
    ensureSourceSelection(mode, sources);
    sourceOptionsByMode.value = {
      ...sourceOptionsByMode.value,
      [mode]: sources,
    };
    if (requestToken !== sourceRequestToken || mode !== activeMode.value) {
      return;
    }
    sourceOptions.value = sources;
    void queuePreviewRestart();
    if (!shouldUpdateStatus) {
      return;
    }
    actionStatus.value = "idle";
    if (sources.length === 0) {
      actionMessage.value = mode === "window"
        ? "未发现可录制的应用窗口。请先打开目标应用。"
        : "未发现可录制的屏幕。";
    } else {
      actionMessage.value = mode === "window"
        ? "请选择一个应用窗口后开始录像。"
        : "请选择一个屏幕后开始录像。";
    }
  } catch (error) {
    if (requestToken !== sourceRequestToken || mode !== activeMode.value) {
      return;
    }
    if (!shouldUpdateStatus) {
      return;
    }
    actionStatus.value = "error";
    actionMessage.value = error instanceof Error ? error.message : String(error);
    sourceOptions.value = [];
  }
}

async function refreshActiveModeData() {
  if (!canUseSystemRecorder) {
    return;
  }
  await Promise.all([
    loadRecorderState(),
    loadSources(activeMode.value),
  ]);
}

function flushChunk(chunk: Blob) {
  if (!activeSessionId || chunk.size <= 0) {
    return Promise.resolve();
  }
  return chunk.arrayBuffer().then((buffer) => {
    return appendSystemRecorderChunk(activeSessionId, new Uint8Array(buffer));
  });
}

function attachTrackEndHandlers(stream: MediaStream) {
  stream.getVideoTracks().forEach((track) => {
    track.addEventListener(
      "ended",
      () => {
        if (!stopRecordingRequested && mediaRecorder && mediaRecorder.state !== "inactive") {
          void handleStopRecording();
        }
      },
      { once: true },
    );
  });
}

async function createCaptureSourceStream() {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: {
      frameRate: {
        ideal: selectedFrameRate.value,
        max: selectedFrameRate.value,
      },
    },
    audio: captureAudioEnabled.value,
  });
  attachTrackEndHandlers(stream);
  return stream;
}

function waitForVideoMetadata(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
    };
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Failed to load capture stream metadata."));
    };
    video.addEventListener("loadedmetadata", onLoaded, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

function fitResolution(
  sourceWidth: number,
  sourceHeight: number,
  preset: ResolutionPreset,
) {
  if (!preset.width || !preset.height) {
    return {
      width: Math.max(2, Math.floor(sourceWidth)),
      height: Math.max(2, Math.floor(sourceHeight)),
    };
  }

  const widthRatio = preset.width / sourceWidth;
  const heightRatio = preset.height / sourceHeight;
  const scale = Math.min(widthRatio, heightRatio, 1);

  return {
    width: Math.max(2, Math.floor((sourceWidth * scale) / 2) * 2),
    height: Math.max(2, Math.floor((sourceHeight * scale) / 2) * 2),
  };
}

async function createConfiguredRecorderStream(stream: MediaStream) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await waitForVideoMetadata(video);
  try {
    await video.play();
  } catch {
    // Playback can fail without affecting capture after metadata is ready.
  }

  const sourceTrack = stream.getVideoTracks()[0];
  const trackSettings = sourceTrack?.getSettings?.() ?? {};
  const sourceWidth = Number(trackSettings.width ?? video.videoWidth ?? 1920);
  const sourceHeight = Number(trackSettings.height ?? video.videoHeight ?? 1080);
  const outputSize = fitResolution(
    sourceWidth,
    sourceHeight,
    selectedResolutionPreset.value,
  );
  const canvas = document.createElement("canvas");
  canvas.width = outputSize.width;
  canvas.height = outputSize.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D context is unavailable.");
  }

  const drawFrame = () => {
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
  };
  drawFrame();
  renderIntervalId = setInterval(
    drawFrame,
    Math.max(16, Math.floor(1000 / selectedFrameRate.value)),
  );

  const nextCanvasStream = canvas.captureStream(selectedFrameRate.value);
  const tracks: MediaStreamTrack[] = [...nextCanvasStream.getVideoTracks()];
  const sourceAudioTracks = stream.getAudioTracks();
  audioTrackAvailable.value = sourceAudioTracks.length > 0;
  if (captureAudioEnabled.value && sourceAudioTracks.length > 0) {
    tracks.push(...sourceAudioTracks);
  }

  renderVideoElement = video;
  renderCanvasElement = canvas;
  canvasMediaStream = nextCanvasStream;
  outputWidth.value = outputSize.width;
  outputHeight.value = outputSize.height;

  return new MediaStream(tracks);
}

function resetRecorderRuntime() {
  activeSessionId = "";
  mediaRecorder = null;
  chunkWriteChain = Promise.resolve();
  stopRecordingPromise = null;
  stopRecordingRequested = false;
  resetOutputInfo();
  stopMediaTracks();
}

async function abortActiveRecording(message: string) {
  const sessionId = activeSessionId;
  resetRecorderRuntime();
  recorderState.value = await abortSystemRecorder(sessionId, message);
}

async function handleStartRecording() {
  if (!canUseSystemRecorder) {
    return;
  }
  if (!activeSourceId.value) {
    actionStatus.value = "error";
    actionMessage.value = "请先选择一个录制源。";
    return;
  }

  actionStatus.value = "loading";
  let preparedSessionId = "";
  try {
    previewPaused = true;
    if (previewTask) {
      await previewTask;
    }
    const startResult = await startSystemRecorder({
      mode: activeMode.value,
      sourceId: activeSourceId.value,
      captureAudio: captureAudioEnabled.value,
      transcodeToMp4: transcodeToMp4Enabled.value,
    });
    recorderState.value = startResult.state;
    if (startResult.canceled || !startResult.sessionId) {
      actionStatus.value = "idle";
      actionMessage.value = "已取消开始录像。";
      return;
    }

    preparedSessionId = startResult.sessionId;
    activeSessionId = startResult.sessionId;
    previewRequestToken += 1;
    if (previewMediaStream) {
      previewMediaStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignore preview track stop failures during start.
        }
      });
      previewMediaStream = null;
    }
    if (previewVideoRef.value) {
      previewVideoRef.value.srcObject = null;
    }
    recordingMimeType.value = pickRecorderMimeType();
    sourceMediaStream = await createCaptureSourceStream();
    recorderMediaStream = await createConfiguredRecorderStream(sourceMediaStream);

    mediaRecorder = recordingMimeType.value
      ? new MediaRecorder(recorderMediaStream, { mimeType: recordingMimeType.value })
      : new MediaRecorder(recorderMediaStream);

    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (!event.data || event.data.size <= 0) {
        return;
      }
      chunkWriteChain = chunkWriteChain.then(() => flushChunk(event.data));
    });

    mediaRecorder.addEventListener("error", (event) => {
      const message = event.error?.message || "MediaRecorder error.";
      void abortActiveRecording(message).catch(() => {});
    });

    mediaRecorder.start(RECORDING_TIMESLICE_MS);
    actionStatus.value = "success";
    actionMessage.value = captureAudioEnabled.value && !audioTrackAvailable.value
      ? "录像已开始，但当前源没有可录制的系统音频轨道。"
      : "录像已开始，可在这里停止。";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    actionStatus.value = "error";
    actionMessage.value = message;
    if (preparedSessionId || activeSessionId) {
      try {
        await abortSystemRecorder(preparedSessionId || activeSessionId, message);
      } catch {
        // Ignore abort cleanup errors after failed start.
      }
    }
    resetRecorderRuntime();
    previewPaused = false;
    await queuePreviewRestart();
    await loadRecorderState();
  }
}

async function handleStopRecording() {
  if (!canUseSystemRecorder || !mediaRecorder || !activeSessionId) {
    return;
  }
  if (stopRecordingPromise) {
    return stopRecordingPromise;
  }

  stopRecordingRequested = true;
  stopRecordingPromise = (async () => {
    const sessionId = activeSessionId;
    const recorder = mediaRecorder;
    actionStatus.value = "loading";
    actionMessage.value = transcodeToMp4Enabled.value
      ? "正在停止录像并转码 MP4，请稍候..."
      : "正在停止录像，请稍候...";

    try {
      await new Promise<void>((resolve, reject) => {
        recorder.addEventListener("stop", () => resolve(), { once: true });
        recorder.addEventListener(
          "error",
          (event) => {
            reject(event.error ?? new Error("MediaRecorder error."));
          },
          { once: true },
        );
        if (recorder.state === "inactive") {
          resolve();
          return;
        }
        recorder.stop();
      });
      await chunkWriteChain;
      stopMediaTracks();
      recorderState.value = await finishSystemRecorder(sessionId);
      if (recorderState.value.lastError) {
        actionStatus.value = "error";
        actionMessage.value = recorderState.value.lastError;
      } else {
        actionStatus.value = "success";
        actionMessage.value = transcodeToMp4Enabled.value
          ? "录像已停止，MP4 转码已完成。"
          : "录像已停止。";
      }
      resetRecorderRuntime();
      previewPaused = false;
      await queuePreviewRestart();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      actionStatus.value = "error";
      actionMessage.value = message;
      stopMediaTracks();
      recorderState.value = await abortSystemRecorder(sessionId, message);
      resetRecorderRuntime();
      previewPaused = false;
      await queuePreviewRestart();
    } finally {
      stopRecordingPromise = null;
    }
  })();

  return stopRecordingPromise;
}

async function handlePickFfmpegPath() {
  if (!canUseSystemRecorder) {
    return;
  }
  actionStatus.value = "loading";
  try {
    const result = await pickSystemRecorderFfmpegPath();
    recorderState.value = result.state;
    ffmpegPathDraft.value = result.state.ffmpegConfiguredPath || result.filePath || "";
    ffmpegPathDirty.value = false;
    actionStatus.value = result.canceled ? "idle" : "success";
    actionMessage.value = result.canceled
      ? "未修改 ffmpeg 路径。"
      : "ffmpeg 路径已更新。";
  } catch (error) {
    actionStatus.value = "error";
    actionMessage.value = error instanceof Error ? error.message : String(error);
  }
}

async function handleSaveFfmpegPath() {
  if (!canUseSystemRecorder) {
    return;
  }
  actionStatus.value = "loading";
  try {
    recorderState.value = await setSystemRecorderFfmpegPath(ffmpegPathDraft.value);
    ffmpegPathDraft.value = recorderState.value.ffmpegConfiguredPath || recorderState.value.ffmpegResolvedPath || "";
    ffmpegPathDirty.value = false;
    actionStatus.value = "success";
    actionMessage.value = ffmpegPathDraft.value.trim()
      ? "ffmpeg 路径已保存。"
      : "已清空 ffmpeg 配置，将优先尝试 PATH 中的 ffmpeg。";
  } catch (error) {
    actionStatus.value = "error";
    actionMessage.value = error instanceof Error ? error.message : String(error);
  }
}

function syncRouteSelection(scrollIntoView = false) {
  const raw = route.query.systemApp;
  const nextId = typeof raw === "string" ? raw.trim() : "";
  if (RECORDER_APP_IDS.includes(nextId as (typeof RECORDER_APP_IDS)[number])) {
    activeSystemAppId.value = nextId;
    if (scrollIntoView) {
      setTimeout(() => {
        panelRef.value?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
    }
  }
}

onMounted(async () => {
  if (!canUseSystemRecorder) {
    actionStatus.value = "idle";
    actionMessage.value = "当前是浏览器模式。系统录像仅在 Electron 桌面运行时可用。";
    return;
  }

  await loadSystemApps();
  syncRouteSelection(true);
  await Promise.all([
    loadRecorderState({ syncDraft: true }),
    loadSources(activeMode.value),
  ]);
  statePollingTimer = setInterval(() => {
    void loadRecorderState();
  }, 1500);
});

watch(
  () => route.query.systemApp,
  () => {
    syncRouteSelection(true);
  },
);

watch(
  () => activeMode.value,
  (mode) => {
    sourceOptions.value = sourceOptionsByMode.value[mode];
    void loadSources(mode);
  },
);

watch(
  () => activeSourceId.value,
  () => {
    void queuePreviewRestart();
  },
);

onBeforeUnmount(() => {
  if (statePollingTimer) {
    clearInterval(statePollingTimer);
    statePollingTimer = null;
  }
  if (activeSessionId) {
    void abortSystemRecorder(activeSessionId, "Window closed while recording.").catch(() => {});
  }
  previewPaused = true;
  resetRecorderRuntime();
});
</script>

<template>
  <section
    ref="panelRef"
    class="mt-4 rounded-2xl border border-slate-700 bg-slate-900/55 p-4 lg:p-5"
  >
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p class="text-xs uppercase tracking-[0.2em] text-cyan-300/90">System Apps</p>
        <p class="mt-1.5 text-xl font-semibold text-slate-100">系统录像</p>
        <p class="mt-1 text-sm text-slate-400">
          系统应用独立于用户安装应用。这里的录像工具使用 Electron 官方 desktopCapturer 和浏览器 MediaRecorder。
        </p>
      </div>
      <button
        type="button"
        class="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
        :disabled="!canUseSystemRecorder"
        @click="refreshActiveModeData"
      >
        Refresh Sources
      </button>
    </div>

    <div
      v-if="!canUseSystemRecorder"
      class="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-4 text-sm text-amber-100"
    >
      浏览器模式未注入 Electron API，因此无法枚举屏幕或选择窗口。
      请使用 `pnpm electron:dev` 或打包后的桌面程序打开系统录像器。
    </div>

    <div
      v-if="canUseSystemRecorder"
      class="mt-4 grid gap-2 md:grid-cols-2"
    >
      <button
        v-for="item in systemApps"
        :key="item.id"
        type="button"
        class="rounded-2xl border p-4 text-left transition"
        :class="
          activeSystemAppId === item.id
            ? 'border-cyan-400 bg-cyan-500/10'
            : 'border-slate-700 bg-slate-950/60 hover:border-slate-500'
        "
        @click="activeSystemAppId = item.id"
      >
        <div class="flex items-start gap-3">
          <span class="inline-flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-800">
            <img
              v-if="item.iconDataUrl"
              :src="item.iconDataUrl"
              alt=""
              class="h-11 w-11 object-contain"
            />
            <span v-else class="text-sm font-semibold text-slate-200">{{ item.name.slice(0, 1) }}</span>
          </span>
          <div class="min-w-0">
            <p class="text-sm font-semibold text-slate-100">{{ item.name }}</p>
            <p class="mt-1 text-xs text-slate-400">{{ item.description || item.source }}</p>
          </div>
        </div>
      </button>
    </div>

    <div
      v-if="canUseSystemRecorder"
      class="mt-4 rounded-xl border border-slate-700 bg-slate-950/70 p-3"
    >
      <div class="flex flex-wrap items-center gap-2">
        <span
          class="rounded-md px-2 py-1 text-xs"
          :class="
            recorderState.recording
              ? 'bg-rose-500/20 text-rose-200'
              : recorderState.transcoding
                ? 'bg-cyan-500/20 text-cyan-200'
              : recorderState.available
                ? 'bg-emerald-500/20 text-emerald-200'
                : 'bg-amber-500/20 text-amber-200'
          "
        >
          {{
            recorderState.recording
              ? 'Recording'
              : recorderState.transcoding
                ? 'Transcoding'
              : recorderState.available
                ? 'Ready'
                : 'Unavailable'
          }}
        </span>
        <span
          class="rounded-md px-2 py-1 text-xs"
          :class="
            actionStatus === 'success'
              ? 'bg-emerald-500/20 text-emerald-200'
              : actionStatus === 'error'
                ? 'bg-rose-500/20 text-rose-200'
                : actionStatus === 'loading'
                  ? 'bg-amber-500/20 text-amber-200'
                  : 'bg-slate-800 text-slate-300'
          "
        >
          {{ actionStatus }}
        </span>
        <span v-if="activeRecordingLabel" class="text-xs text-slate-300">{{ activeRecordingLabel }}</span>
        <span v-if="currentStartedAtLabel" class="text-xs text-slate-500">Started {{ currentStartedAtLabel }}</span>
      </div>
      <p class="mt-2 text-xs text-slate-400">{{ actionMessage }}</p>
      <p v-if="recorderState.lastError" class="mt-1 text-xs text-rose-300">{{ recorderState.lastError }}</p>
      <div
        v-if="recorderState.transcoding && transcodeProgressPercent !== null"
        class="mt-3"
      >
        <div class="flex items-center justify-between text-[11px] text-slate-400">
          <span>MP4 转码进度</span>
          <span>{{ transcodeProgressPercent.toFixed(1) }}%</span>
        </div>
        <div class="mt-1 h-2 overflow-hidden rounded-full bg-slate-800">
          <div
            class="h-full rounded-full bg-cyan-400 transition-[width] duration-300"
            :style="{ width: `${transcodeProgressPercent}%` }"
          />
        </div>
      </div>
    </div>

    <div
      v-if="canUseSystemRecorder"
      class="mt-4 grid gap-4 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]"
    >
      <div class="space-y-3">
        <div class="rounded-xl border border-slate-700 bg-slate-950/60 p-4">
          <p class="text-sm font-medium text-slate-100">{{ activeSystemApp?.name || "录像工具" }}</p>
          <p class="mt-1 text-xs text-slate-400">{{ activeSystemApp?.description || "选择录制源并开始录像。" }}</p>

          <div class="mt-3 space-y-3">
            <label class="block">
              <span class="text-[11px] font-medium uppercase tracking-wide text-slate-400">Source</span>
              <select
                v-model="activeSourceId"
                class="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-500/50 focus:ring"
              >
                <option value="" disabled>
                  {{ sourceOptions.length === 0 ? "No source available" : "Select source" }}
                </option>
                <option
                  v-for="source in sourceOptions"
                  :key="source.id"
                  :value="source.id"
                >
                  {{ source.name }}
                </option>
              </select>
            </label>

            <div class="grid gap-3 sm:grid-cols-2">
              <label class="block">
                <span class="text-[11px] font-medium uppercase tracking-wide text-slate-400">Resolution</span>
                <select
                  v-model="selectedResolutionId"
                  class="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-500/50 focus:ring disabled:opacity-60"
                  :disabled="recorderState.recording"
                >
                  <option
                    v-for="preset in RESOLUTION_PRESETS"
                    :key="preset.id"
                    :value="preset.id"
                  >
                    {{ preset.label }}
                  </option>
                </select>
              </label>

              <label class="block">
                <span class="text-[11px] font-medium uppercase tracking-wide text-slate-400">Frame Rate</span>
                <select
                  v-model="selectedFrameRate"
                  class="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-500/50 focus:ring disabled:opacity-60"
                  :disabled="recorderState.recording"
                >
                  <option
                    v-for="fps in FRAME_RATE_OPTIONS"
                    :key="fps"
                    :value="fps"
                  >
                    {{ fps }} FPS
                  </option>
                </select>
              </label>
            </div>

            <div class="grid gap-2 sm:grid-cols-2">
              <label class="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100">
                <input
                  v-model="captureAudioEnabled"
                  type="checkbox"
                  class="h-4 w-4 accent-cyan-400"
                  :disabled="recorderState.recording"
                />
                <span>录制系统声音</span>
              </label>

              <label class="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100">
                <input
                  v-model="transcodeToMp4Enabled"
                  type="checkbox"
                  class="h-4 w-4 accent-cyan-400"
                  :disabled="recorderState.recording || recorderState.transcoding"
                />
                <span>停止后转 MP4</span>
              </label>
            </div>

            <div
              v-if="transcodeToMp4Enabled"
              class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
            >
              <input
                v-model="ffmpegPathDraft"
                type="text"
                class="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-500/50 placeholder:text-slate-500 focus:ring disabled:opacity-60"
                :disabled="recorderState.recording || recorderState.transcoding"
                placeholder="ffmpeg.exe path, or leave empty to use PATH"
                @input="ffmpegPathDirty = true"
              />
              <button
                type="button"
                class="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200 disabled:opacity-60"
                :disabled="recorderState.recording || recorderState.transcoding"
                @click="handlePickFfmpegPath"
              >
                Select
              </button>
              <button
                type="button"
                class="rounded-lg border border-cyan-500/40 px-3 py-2 text-xs text-cyan-200 transition hover:border-cyan-300 hover:text-cyan-100 disabled:opacity-60"
                :disabled="recorderState.recording || recorderState.transcoding"
                @click="handleSaveFfmpegPath"
              >
                Save
              </button>
            </div>

            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class="rounded-lg bg-cyan-400 px-3 py-2 text-xs font-semibold text-slate-900 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="recorderState.recording || recorderState.transcoding || !activeSourceId"
                @click="handleStartRecording"
              >
                Start Recording
              </button>
              <button
                type="button"
                class="rounded-lg border border-rose-500/40 px-3 py-2 text-xs text-rose-200 transition hover:border-rose-400 hover:text-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="!recorderState.recording"
                @click="handleStopRecording"
              >
                Stop Recording
              </button>
            </div>
          </div>
        </div>

        <div class="rounded-xl border border-slate-700 bg-slate-950/60 p-3 text-xs text-slate-400">
          <p>
            当前设置:
            <code>{{ selectedResolutionPreset.label }}</code>
            /
            <code>{{ selectedFrameRate }} FPS</code>
            /
            <code>{{ captureAudioEnabled ? "音频开启" : "音频关闭" }}</code>
            /
            <code>{{ transcodeToMp4Enabled ? "停止后转 MP4" : "保留 WebM" }}</code>
          </p>
          <p class="mt-1">
            Output codec:
            <code>{{ recordingMimeType || "pending" }}</code>
            <span v-if="outputWidth && outputHeight">
              /
              <code>{{ outputResolutionLabel }}</code>
            </span>
            <span v-if="captureAudioEnabled">
              /
              <code>{{ audioTrackAvailable ? "已写入音频" : "当前源无音频轨" }}</code>
            </span>
            <span v-if="transcodeToMp4Enabled">
              /
              <code>ffmpeg: {{ recorderState.ffmpegResolvedPath || "not found" }}</code>
            </span>
          </p>
          <p class="mt-1">
            Output:
            <code>{{ outputPathLabel }}</code>
          </p>
        </div>
      </div>

      <div class="rounded-xl border border-slate-700 bg-slate-950/60 p-4">
        <p class="text-sm font-medium text-slate-100">Source Preview</p>
        <div
          class="mt-3 flex min-h-[320px] items-center justify-center overflow-hidden rounded-xl border border-slate-800 bg-slate-950"
        >
          <video
            ref="previewVideoRef"
            autoplay
            muted
            playsinline
            class="h-full max-h-[520px] w-full object-contain"
            :class="previewActive ? 'block' : 'hidden'"
          />
          <img
            v-if="!previewActive && selectedSource?.thumbnailDataUrl"
            :src="selectedSource.thumbnailDataUrl"
            alt=""
            class="h-full max-h-[520px] w-full object-contain"
          />
          <div
            v-if="!previewActive && !selectedSource?.thumbnailDataUrl"
            class="px-6 text-center text-xs text-slate-500"
          >
            选中录制源后会在这里显示桌面或窗口缩略图。
          </div>
        </div>
        <div class="mt-3 flex items-center gap-3">
          <span class="inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg bg-slate-800">
            <img
              v-if="selectedSource?.appIconDataUrl"
              :src="selectedSource.appIconDataUrl"
              alt=""
              class="h-8 w-8 object-contain"
            />
            <span v-else class="text-xs text-slate-300">{{ selectedSource?.name?.slice(0, 1) || "-" }}</span>
          </span>
          <div class="min-w-0">
            <p class="truncate text-sm text-slate-100">{{ selectedSource?.name || "未选择录制源" }}</p>
            <p class="text-xs text-slate-500">
              {{ activeMode === "window" ? "应用窗口" : "屏幕" }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
