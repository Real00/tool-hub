// @ts-nocheck
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const SYSTEM_RECORDER_APP_IDS = new Set([
  "builtin:screen-recorder",
  "builtin:window-recorder",
]);

const RECORDER_SOURCE_KINDS = new Set(["screen", "window"]);
const DEFAULT_OUTPUT_EXTENSION = "webm";
const DEFAULT_TRANSCODE_EXTENSION = "mp4";

function createSystemRecorderManager(options = {}) {
  const app = options.app;
  const desktopCapturer = options.desktopCapturer;
  const dialog = options.dialog;
  const getSettingsStore = options.getSettingsStore;

  const state = {
    mode: null,
    sourceId: null,
    sourceName: null,
    outputPath: null,
    startedAt: null,
    lastError: null,
    recording: false,
    transcoding: false,
    transcodeToMp4: false,
    transcodeProgressPercent: null,
  };

  let pendingDesktopSource = null;
  let activeSession = null;
  let activeTranscode = null;

  function makeRecorderStateError(message) {
    return String(message ?? "").trim() || "录像已中止。";
  }

  function normalizeRecorderMode(input) {
    const value = String(input ?? "").trim().toLowerCase();
    if (!RECORDER_SOURCE_KINDS.has(value)) {
      throw new Error(`Unsupported recorder mode: ${input}`);
    }
    return value;
  }

  function normalizePathInput(input) {
    const value = String(input ?? "").trim();
    if (!value) {
      return "";
    }
    return path.resolve(value);
  }

  function getRecorderSettingStore() {
    const store = getSettingsStore?.();
    if (!store) {
      throw new Error("Settings store is unavailable.");
    }
    return store;
  }

  async function getConfiguredFfmpegPath() {
    const store = getRecorderSettingStore();
    if (typeof store.getRecorderFfmpegPath !== "function") {
      return "";
    }
    return normalizePathInput(await store.getRecorderFfmpegPath());
  }

  async function saveConfiguredFfmpegPath(input) {
    const store = getRecorderSettingStore();
    if (typeof store.saveRecorderFfmpegPath !== "function") {
      throw new Error("Recorder ffmpeg path storage is unavailable.");
    }
    return store.saveRecorderFfmpegPath(normalizePathInput(input));
  }

  async function fileExists(filePath) {
    if (!filePath) {
      return false;
    }
    try {
      const stat = await fs.promises.stat(filePath);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  async function resolveFfmpegFromPath() {
    const command = process.platform === "win32" ? "where.exe" : "which";
    try {
      const { stdout } = await execFileAsync(command, ["ffmpeg"], {
        windowsHide: true,
        encoding: "utf8",
      });
      const first = String(stdout ?? "")
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .find(Boolean);
      return first ? normalizePathInput(first) : "";
    } catch {
      return "";
    }
  }

  async function resolveFfmpegExecutable(explicitPathInput = "") {
    const explicitPath = normalizePathInput(explicitPathInput);
    if (await fileExists(explicitPath)) {
      return explicitPath;
    }

    const configuredPath = await getConfiguredFfmpegPath();
    if (await fileExists(configuredPath)) {
      return configuredPath;
    }

    const pathResolved = await resolveFfmpegFromPath();
    if (await fileExists(pathResolved)) {
      return pathResolved;
    }

    return "";
  }

  function shouldUseShellForExecutable(filePath) {
    const extension = path.extname(String(filePath ?? "")).toLowerCase();
    return extension === ".cmd" || extension === ".bat";
  }

  function getVideosDirectory() {
    try {
      return app.getPath("videos");
    } catch {
      return app.getPath("home");
    }
  }

  function formatTimestampForFileName(date = new Date()) {
    const yyyy = String(date.getFullYear());
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const mi = String(date.getMinutes()).padStart(2, "0");
    const ss = String(date.getSeconds()).padStart(2, "0");
    return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
  }

  function sanitizeFileStem(input) {
    return String(input ?? "")
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function buildDefaultOutputPath(mode, sourceName) {
    const prefix = mode === "window" ? "window-recording" : "screen-recording";
    const safeSourceName = sanitizeFileStem(sourceName);
    const fileName = safeSourceName
      ? `${prefix}-${safeSourceName}-${formatTimestampForFileName()}.${DEFAULT_OUTPUT_EXTENSION}`
      : `${prefix}-${formatTimestampForFileName()}.${DEFAULT_OUTPUT_EXTENSION}`;
    return path.join(getVideosDirectory(), fileName);
  }

  function replaceFileExtension(filePath, extension) {
    const parsed = path.parse(filePath);
    return path.join(parsed.dir, `${parsed.name}.${extension}`);
  }

  async function pickOutputPath(mode, sourceName, transcodeToMp4 = false) {
    const outputExtension = transcodeToMp4 ? DEFAULT_TRANSCODE_EXTENSION : DEFAULT_OUTPUT_EXTENSION;
    const result = await dialog.showSaveDialog(options.getMainWindow?.() ?? undefined, {
      title: mode === "window" ? "保存应用录像" : "保存屏幕录像",
      defaultPath: replaceFileExtension(buildDefaultOutputPath(mode, sourceName), outputExtension),
      filters: [
        transcodeToMp4
          ? { name: "MP4 Video", extensions: ["mp4"] }
          : { name: "WebM Video", extensions: ["webm"] },
        { name: "All Files", extensions: ["*"] },
      ],
      showOverwriteConfirmation: true,
    });

    if (result.canceled || !result.filePath) {
      return "";
    }
    return normalizePathInput(result.filePath);
  }

  async function openRecordingWriteStream(filePath) {
    return new Promise((resolve, reject) => {
      const stream = fs.createWriteStream(filePath, { flags: "w" });

      const cleanup = () => {
        stream.removeListener("open", handleOpen);
        stream.removeListener("error", handleError);
      };

      const handleOpen = () => {
        cleanup();
        resolve(stream);
      };

      const handleError = (error) => {
        cleanup();
        reject(error);
      };

      stream.once("open", handleOpen);
      stream.once("error", handleError);
    });
  }

  function toPublicSource(source, kind) {
    const name = String(source?.name ?? "").trim();
    return {
      id: String(source?.id ?? ""),
      kind,
      name: name || (kind === "window" ? "Unnamed Window" : "Screen"),
      displayId: String(source?.display_id ?? "").trim() || undefined,
      thumbnailDataUrl:
        source?.thumbnail && typeof source.thumbnail.isEmpty === "function" && !source.thumbnail.isEmpty()
          ? source.thumbnail.toDataURL()
          : undefined,
      appIconDataUrl:
        source?.appIcon && typeof source.appIcon.isEmpty === "function" && !source.appIcon.isEmpty()
          ? source.appIcon.toDataURL()
          : undefined,
    };
  }

  async function collectDesktopSources(mode) {
    const sourceType = mode === "window" ? "window" : "screen";
    const sources = await desktopCapturer.getSources({
      types: [sourceType],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: sourceType === "window",
    });

    return sources
      .filter((source) => {
        const id = String(source?.id ?? "").trim();
        if (!id) {
          return false;
        }
        if (mode !== "window") {
          return true;
        }
        const normalizedName = String(source?.name ?? "").trim().toLowerCase();
        return Boolean(normalizedName);
      });
  }

  async function listRecorderSources(modeInput) {
    if (process.platform !== "win32") {
      throw new Error("系统录像当前仅支持 Windows。");
    }
    const mode = normalizeRecorderMode(modeInput);
    const sources = await collectDesktopSources(mode);
    return sources.map((source) => toPublicSource(source, mode));
  }

  function isRecorderSystemAppId(appIdInput) {
    return SYSTEM_RECORDER_APP_IDS.has(String(appIdInput ?? "").trim());
  }

  function createRecorderState() {
    return {
      available: process.platform === "win32",
      recording: state.recording,
      transcoding: state.transcoding,
      transcodeToMp4: state.transcodeToMp4,
      transcodeProgressPercent: state.transcodeProgressPercent,
      mode: state.mode,
      sourceId: state.sourceId,
      sourceName: state.sourceName,
      outputPath: state.outputPath,
      startedAt: state.startedAt,
      lastError: state.lastError,
      ffmpegConfiguredPath: "",
      ffmpegResolvedPath: null,
    };
  }

  async function getRecorderState() {
    const configuredPath = await getConfiguredFfmpegPath().catch(() => "");
    const resolvedPath = await resolveFfmpegExecutable().catch(() => "");
    return {
      ...createRecorderState(),
      ffmpegConfiguredPath: configuredPath,
      ffmpegResolvedPath: resolvedPath || null,
    };
  }

  function clearPendingSource() {
    pendingDesktopSource = null;
  }

  async function preparePreviewCapture(input = {}) {
    if (process.platform !== "win32") {
      throw new Error("系统录像当前仅支持 Windows。");
    }

    const mode = normalizeRecorderMode(input.mode);
    const sourceId = String(input.sourceId ?? "").trim();
    if (!sourceId) {
      throw new Error("Preview source is required.");
    }

    const sources = await collectDesktopSources(mode);
    const desktopSource = sources.find((item) => String(item.id) === sourceId);
    if (!desktopSource) {
      throw new Error(`Preview source not found: ${sourceId}`);
    }

    pendingDesktopSource = {
      desktopSource,
      captureAudio: false,
    };
    return true;
  }

  function resetRecorderState({ preserveOutputPath = false } = {}) {
    state.recording = false;
    state.transcoding = false;
    state.transcodeProgressPercent = null;
    state.mode = null;
    state.sourceId = null;
    state.sourceName = null;
    state.startedAt = null;
    if (!preserveOutputPath) {
      state.outputPath = null;
    }
  }

  async function startRecorder(input = {}) {
    if (process.platform !== "win32") {
      throw new Error("系统录像当前仅支持 Windows。");
    }
    if (activeSession) {
      throw new Error("Recorder is already running.");
    }

    const mode = normalizeRecorderMode(input.mode);
    const sourceId = String(input.sourceId ?? "").trim();
    if (!sourceId) {
      throw new Error("Recording source is required.");
    }

    const sources = await collectDesktopSources(mode);
    const desktopSource = sources.find((item) => String(item.id) === sourceId);
    if (!desktopSource) {
      throw new Error(`Recording source not found: ${sourceId}`);
    }

    const transcodeToMp4 = input.transcodeToMp4 === true;
    let ffmpegPath = "";
    if (transcodeToMp4) {
      ffmpegPath = await resolveFfmpegExecutable();
      if (!ffmpegPath) {
        throw new Error("已启用 MP4 转码，但未找到 ffmpeg。请先配置 ffmpeg.exe 路径。");
      }
    }

    const outputPath = await pickOutputPath(mode, desktopSource.name, transcodeToMp4);
    if (!outputPath) {
      return {
        canceled: true,
        sessionId: null,
        outputPath: null,
        state: await getRecorderState(),
      };
    }

    const tempOutputPath = transcodeToMp4
      ? replaceFileExtension(outputPath, `${Date.now()}.recording.webm`)
      : outputPath;

    await fs.promises.mkdir(path.dirname(tempOutputPath), { recursive: true });
    const stream = await openRecordingWriteStream(tempOutputPath);
    const sessionId = crypto.randomUUID();

    activeSession = {
      id: sessionId,
      stream,
      outputPath,
      tempOutputPath,
      captureAudio: input.captureAudio === true,
      transcodeToMp4,
      ffmpegPath,
    };
    pendingDesktopSource = {
      desktopSource,
      captureAudio: input.captureAudio === true,
    };
    state.recording = true;
    state.transcodeToMp4 = transcodeToMp4;
    state.transcodeProgressPercent = null;
    state.mode = mode;
    state.sourceId = sourceId;
    state.sourceName = String(desktopSource.name ?? "").trim() || null;
    state.outputPath = outputPath;
    state.startedAt = Date.now();
    state.lastError = null;

    return {
      canceled: false,
      sessionId,
      outputPath,
      state: await getRecorderState(),
    };
  }

  async function appendRecordingChunk(sessionIdInput, chunkInput) {
    if (!activeSession) {
      throw new Error("Recording session is not active.");
    }
    const sessionId = String(sessionIdInput ?? "").trim();
    if (!sessionId || sessionId !== activeSession.id) {
      throw new Error("Recording session id mismatch.");
    }

    let chunkBuffer;
    if (chunkInput instanceof Uint8Array) {
      chunkBuffer = Buffer.from(chunkInput);
    } else if (ArrayBuffer.isView(chunkInput)) {
      chunkBuffer = Buffer.from(chunkInput.buffer, chunkInput.byteOffset, chunkInput.byteLength);
    } else if (chunkInput instanceof ArrayBuffer) {
      chunkBuffer = Buffer.from(chunkInput);
    } else {
      throw new Error("Recording chunk must be binary data.");
    }

    if (chunkBuffer.byteLength === 0) {
      return;
    }

    await new Promise((resolve, reject) => {
      activeSession.stream.write(chunkBuffer, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  async function closeActiveSession() {
    if (!activeSession) {
      return;
    }
    const current = activeSession;
    activeSession = null;
    clearPendingSource();
    await new Promise((resolve) => {
      current.stream.end(() => {
        resolve();
      });
    });
  }

  async function transcodeRecordingToMp4(session) {
    const durationSeconds = await getMediaDurationSeconds(session.tempOutputPath);
    return new Promise((resolve, reject) => {
      const args = [
        "-y",
        "-i",
        session.tempOutputPath,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        "-progress",
        "pipe:2",
        "-nostats",
        session.outputPath,
      ];
      const child = spawn(session.ffmpegPath, args, {
        cwd: path.dirname(session.outputPath),
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
        shell: shouldUseShellForExecutable(session.ffmpegPath),
      });
      const transcodeState = {
        child,
        session,
        abortReason: "",
      };
      activeTranscode = transcodeState;

      let stderr = "";
      let progressBuffer = "";
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk) => {
        const text = String(chunk ?? "");
        stderr += text;
        progressBuffer += text;
        const lines = progressBuffer.split(/\r?\n/g);
        progressBuffer = lines.pop() ?? "";
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i].trim();
          if (!line.startsWith("out_time_ms=")) {
            continue;
          }
          const outTimeMs = Number(line.slice("out_time_ms=".length));
          if (!Number.isFinite(outTimeMs) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
            continue;
          }
          const processedMs = outTimeMs / 1000;
          const totalMs = durationSeconds * 1000;
          const percent = Math.max(0, Math.min(100, (processedMs / totalMs) * 100));
          state.transcodeProgressPercent = percent;
        }
      });
      child.once("error", (error) => {
        if (activeTranscode === transcodeState) {
          activeTranscode = null;
        }
        reject(error);
      });
      child.once("close", (code) => {
        if (activeTranscode === transcodeState) {
          activeTranscode = null;
        }
        if (transcodeState.abortReason) {
          reject(new Error(transcodeState.abortReason));
          return;
        }
        if (code === 0) {
          state.transcodeProgressPercent = 100;
          resolve();
          return;
        }
        reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
      });
    });
  }

  async function getMediaDurationSeconds(filePath) {
    const ffprobePath = await resolveFfprobeExecutable();
    if (ffprobePath) {
      try {
        const { stdout } = await execFileAsync(
          ffprobePath,
          [
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            filePath,
          ],
          {
            windowsHide: true,
            encoding: "utf8",
          },
        );
        const seconds = Number(String(stdout ?? "").trim());
        if (Number.isFinite(seconds) && seconds > 0) {
          return seconds;
        }
      } catch {
        // Fall back to ffmpeg stderr parsing below.
      }
    }

    const ffmpegPath = await resolveFfmpegExecutable();
    if (!ffmpegPath) {
      return null;
    }
    try {
      await execFileAsync(
        ffmpegPath,
        ["-i", filePath],
        {
          windowsHide: true,
          encoding: "utf8",
        },
      );
    } catch (error) {
      const stderr = String(error?.stderr ?? "");
      const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
      if (match) {
        const hours = Number(match[1]);
        const minutes = Number(match[2]);
        const seconds = Number(match[3]);
        const totalSeconds = (hours * 3600) + (minutes * 60) + seconds;
        if (Number.isFinite(totalSeconds) && totalSeconds > 0) {
          return totalSeconds;
        }
      }
    }
    return null;
  }

  async function resolveFfprobeExecutable() {
    const configuredFfmpegPath = await getConfiguredFfmpegPath().catch(() => "");
    const candidateBase = configuredFfmpegPath || (await resolveFfmpegExecutable());
    if (!candidateBase) {
      return "";
    }
    const parsed = path.parse(candidateBase);
    const siblingName = parsed.name.toLowerCase() === "ffmpeg" ? `ffprobe${parsed.ext}` : "";
    if (siblingName) {
      const siblingPath = path.join(parsed.dir, siblingName);
      if (await fileExists(siblingPath)) {
        return siblingPath;
      }
    }
    const command = process.platform === "win32" ? "where.exe" : "which";
    try {
      const { stdout } = await execFileAsync(command, ["ffprobe"], {
        windowsHide: true,
        encoding: "utf8",
      });
      const first = String(stdout ?? "")
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .find(Boolean);
      return first ? normalizePathInput(first) : "";
    } catch {
      return "";
    }
  }

  async function finishRecorder(sessionIdInput) {
    if (!activeSession) {
      return getRecorderState();
    }
    const sessionId = String(sessionIdInput ?? "").trim();
    if (!sessionId || sessionId !== activeSession.id) {
      throw new Error("Recording session id mismatch.");
    }

    const session = activeSession;
    await closeActiveSession();
    if (session.transcodeToMp4) {
      state.recording = false;
      state.transcoding = true;
      state.transcodeProgressPercent = 0;
      try {
        await transcodeRecordingToMp4(session);
        try {
          await fs.promises.unlink(session.tempOutputPath);
        } catch {
          // Ignore temp cleanup failures after successful transcode.
        }
      } catch (error) {
        state.transcoding = false;
        state.outputPath = session.tempOutputPath;
        state.lastError =
          `MP4 转码失败：${error instanceof Error ? error.message : String(error)}。`
          + ` 已保留原始 WebM 文件：${session.tempOutputPath}`;
        resetRecorderState({ preserveOutputPath: true });
        return getRecorderState();
      }
    }
    state.lastError = null;
    resetRecorderState({ preserveOutputPath: true });
    return getRecorderState();
  }

  async function abortRecorder(sessionIdInput, errorInput = "") {
    const sessionId = String(sessionIdInput ?? "").trim();
    const errorMessage = String(errorInput ?? "").trim();

    if (activeSession && sessionId && sessionId === activeSession.id) {
      const outputPath = activeSession.outputPath;
      const tempOutputPath = activeSession.tempOutputPath;
      const current = activeSession;
      activeSession = null;
      clearPendingSource();
      await new Promise((resolve) => {
        current.stream.destroy();
        resolve();
      });
      try {
        await fs.promises.unlink(tempOutputPath);
      } catch {
        // Ignore cleanup errors for partial files.
      }
    } else {
      clearPendingSource();
    }

    state.lastError = makeRecorderStateError(errorMessage);
    resetRecorderState();
    return getRecorderState();
  }

  async function abortActiveRecorder(reason = "") {
    if (activeTranscode) {
      const transcode = activeTranscode;
      const reasonText =
        `${makeRecorderStateError(reason)} 已保留原始 WebM 文件：${transcode.session.tempOutputPath}`;
      transcode.abortReason = reasonText;
      state.outputPath = transcode.session.tempOutputPath;
      try {
        transcode.child.kill();
      } catch {
        // Ignore kill failures during transcode shutdown.
      }
      return getRecorderState();
    }
    if (!activeSession) {
      return getRecorderState();
    }
    return abortRecorder(activeSession.id, reason);
  }

  function handleDisplayMediaRequest(request, callback) {
    if (!pendingDesktopSource) {
      callback({});
      return;
    }
    const pendingRequest = pendingDesktopSource;
    pendingDesktopSource = null;
    callback({
      video: pendingRequest.desktopSource,
      audio:
        pendingRequest.captureAudio === true && request?.audioRequested
          ? "loopback"
          : undefined,
    });
  }

  async function dispose() {
    if (activeSession) {
      await abortRecorder(activeSession.id, "Recorder disposed.");
    }
  }

  return {
    abortRecorder,
    abortActiveRecorder,
    appendRecordingChunk,
    dispose,
    finishRecorder,
    getRecorderState,
    handleDisplayMediaRequest,
    isRecorderSystemAppId,
    listRecorderSources,
    preparePreviewCapture,
    pickAndSaveFfmpegPath: async () => {
      const result = await dialog.showOpenDialog(options.getMainWindow?.() ?? undefined, {
        title: "选择 ffmpeg 可执行文件",
        properties: ["openFile", "dontAddToRecent"],
        filters: [
          { name: "ffmpeg executable", extensions: ["exe", "cmd", "bat"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return {
          canceled: true,
          filePath: "",
          state: await getRecorderState(),
        };
      }

      const savedPath = await saveConfiguredFfmpegPath(result.filePaths[0]);
      return {
        canceled: false,
        filePath: savedPath,
        state: await getRecorderState(),
      };
    },
    setFfmpegPath: async (filePath) => {
      await saveConfiguredFfmpegPath(filePath);
      return getRecorderState();
    },
    startRecorder,
  };
}

module.exports = {
  SYSTEM_RECORDER_APP_IDS,
  createSystemRecorderManager,
};
