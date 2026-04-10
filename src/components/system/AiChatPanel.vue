<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import AiChatMessageBubble from "./AiChatMessageBubble.vue";
import AiChatSessionList from "./AiChatSessionList.vue";
import {
  beginAiChatStream,
  cancelAiChatStream,
  createAiChatSession,
  deleteAiChatSession,
  getAiChatLaunchState,
  getAiChatSessionMessages,
  getAiChatSettings,
  isElectronRuntime,
  listAiChatModels,
  listAiChatSessions,
  saveAiChatSettings,
  sendAiChatMessage,
  subscribeAiChatLaunch,
  subscribeAiChatStream,
} from "../../platform/electron-bridge";
import type {
  AiChatImageAttachment,
  AiChatLaunchState,
  AiChatMessage,
  AiChatModelOption,
  AiChatSessionSummary,
  AiChatSettings,
  AiChatStreamEvent,
} from "../../types/ai-chat";

const canUseAiChat = isElectronRuntime();
const messagesContainerRef = ref<HTMLElement | null>(null);
const sessions = ref<AiChatSessionSummary[]>([]);
const messages = ref<AiChatMessage[]>([]);
const activeSessionId = ref("");
const composer = ref("");
const pendingAttachments = ref<AiChatImageAttachment[]>([]);
const settingsOpen = ref(false);
const settings = ref<AiChatSettings>({
  provider: "openai-sdk",
  apiType: "chat-completions",
  debugEnabled: false,
  baseUrl: "",
  apiKey: "",
  model: "",
});
const settingsDraft = ref<AiChatSettings>({
  provider: "openai-sdk",
  apiType: "chat-completions",
  debugEnabled: false,
  baseUrl: "",
  apiKey: "",
  model: "",
});
const panelStatus = ref<"idle" | "loading" | "success" | "error">("idle");
const panelMessage = ref("配置 OpenAI 兼容接口后即可开始对话。");
const availableModels = ref<AiChatModelOption[]>([]);
const sessionsLoading = ref(false);
const messagesLoading = ref(false);
const settingsSaving = ref(false);
const modelsLoading = ref(false);
const sending = ref(false);
const historyCollapsed = ref(false);
const historyPanelOpen = ref(false);
const activeRequestId = ref("");
const lastHandledLaunchUpdatedAt = ref(0);
const autoScrollEnabled = ref(true);

let disposed = false;
let unsubscribeStream: (() => void) | null = null;
let unsubscribeLaunch: (() => void) | null = null;
let messagesLoadToken = 0;

const activeSession = computed(() => {
  return sessions.value.find((item) => item.id === activeSessionId.value) ?? null;
});

function cloneAiChatSettings(input: AiChatSettings): AiChatSettings {
  return {
    provider: input.provider === "anthropic-sdk" ? "anthropic-sdk" : "openai-sdk",
    apiType: input.apiType === "responses" ? "responses" : "chat-completions",
    debugEnabled: input.debugEnabled === true,
    baseUrl: String(input.baseUrl ?? "").trim(),
    apiKey: String(input.apiKey ?? "").trim(),
    model: String(input.model ?? "").trim(),
  };
}

function cloneAiChatAttachments(input: AiChatImageAttachment[]): AiChatImageAttachment[] {
  return Array.isArray(input)
    ? input.map((item) => ({
        id: String(item.id ?? "").trim(),
        dataUrl: String(item.dataUrl ?? "").trim(),
        mimeType: String(item.mimeType ?? "").trim(),
      }))
    : [];
}

const hasConfiguredApi = computed(() => {
  return (
    settings.value.apiKey.trim().length > 0 &&
    settings.value.model.trim().length > 0
  );
});

const canSendMessage = computed(() => {
  return (
    canUseAiChat &&
    hasConfiguredApi.value &&
    !sending.value &&
    (composer.value.trim().length > 0 || pendingAttachments.value.length > 0)
  );
});

const effectiveModelOptions = computed(() => {
  const byId = new Map<string, AiChatModelOption>();
  availableModels.value.forEach((item) => {
    if (item.id) {
      byId.set(item.id, item);
    }
  });
  if (settings.value.model.trim()) {
    byId.set(settings.value.model.trim(), { id: settings.value.model.trim() });
  }
  if (settingsDraft.value.model.trim()) {
    byId.set(settingsDraft.value.model.trim(), { id: settingsDraft.value.model.trim() });
  }
  return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
});

const activeSessionTitle = computed(() => {
  return activeSession.value?.title || "AI Chat";
});

const emptyStateText = computed(() => {
  if (!canUseAiChat) {
    return "AI chat is only available in Electron runtime.";
  }
  if (messagesLoading.value) {
    return "Loading conversation...";
  }
  if (!activeSessionId.value) {
    return "没有会话，点击左侧 New Chat 或通过 quick launcher 输入 ai 发起对话。";
  }
  return "当前会话还没有消息。";
});

function formatTime(value: number): string {
  if (!value || !Number.isFinite(value)) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

function sortSessions(items: AiChatSessionSummary[]): AiChatSessionSummary[] {
  return [...items].sort((a, b) => {
    if (a.updatedAt !== b.updatedAt) {
      return b.updatedAt - a.updatedAt;
    }
    return b.createdAt - a.createdAt;
  });
}

function upsertSessionSummary(session: AiChatSessionSummary) {
  const next = sessions.value.filter((item) => item.id !== session.id);
  next.unshift(session);
  sessions.value = sortSessions(next);
}

function patchMessage(messageId: string, updater: (message: AiChatMessage) => AiChatMessage) {
  messages.value = messages.value.map((item) => {
    if (item.id !== messageId) {
      return item;
    }
    return updater(item);
  });
}

function isNearBottom() {
  const element = messagesContainerRef.value;
  if (!element) {
    return true;
  }
  const distance = element.scrollHeight - (element.scrollTop + element.clientHeight);
  return distance < 48;
}

function scrollMessagesToBottom(force = false) {
  if (!force && !autoScrollEnabled.value) {
    return;
  }
  nextTick(() => {
    const element = messagesContainerRef.value;
    if (!element) {
      return;
    }
    element.scrollTop = element.scrollHeight;
  });
}

function handleMessagesScroll() {
  autoScrollEnabled.value = isNearBottom();
}

async function loadSettings() {
  if (!canUseAiChat) {
    return;
  }
  try {
    const nextSettings = cloneAiChatSettings(await getAiChatSettings());
    settings.value = nextSettings;
    settingsDraft.value = cloneAiChatSettings(nextSettings);
  } catch (error) {
    panelStatus.value = "error";
    panelMessage.value = error instanceof Error ? error.message : String(error);
  }
}

function openSettingsDialog() {
  settingsDraft.value = cloneAiChatSettings(settings.value);
  settingsOpen.value = true;
}

async function refreshModelsFromInput(input: Pick<AiChatSettings, "provider" | "baseUrl" | "apiKey">) {
  modelsLoading.value = true;
  try {
    availableModels.value = await listAiChatModels({
      provider: input.provider,
      baseUrl: String(input.baseUrl ?? "").trim(),
      apiKey: String(input.apiKey ?? "").trim(),
    });
    panelStatus.value = "success";
    panelMessage.value = availableModels.value.length > 0 ? "模型列表已刷新。" : "接口可用，但未返回模型列表。";
  } catch (error) {
    panelStatus.value = "error";
    panelMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    modelsLoading.value = false;
  }
}

async function handleRefreshModels() {
  await refreshModelsFromInput(settingsDraft.value);
}

async function loadSessions(preferredSessionId = "") {
  if (!canUseAiChat) {
    return;
  }
  sessionsLoading.value = true;
  try {
    const nextSessions = await listAiChatSessions();
    if (disposed) {
      return;
    }
    sessions.value = sortSessions(nextSessions);

    const preferredId = preferredSessionId || activeSessionId.value;
    if (preferredId && nextSessions.some((item) => item.id === preferredId)) {
      activeSessionId.value = preferredId;
      return;
    }
    activeSessionId.value = nextSessions[0]?.id ?? "";
  } catch (error) {
    panelStatus.value = "error";
    panelMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    sessionsLoading.value = false;
  }
}

async function loadMessages(sessionId: string) {
  if (!canUseAiChat) {
    return;
  }
  const normalized = String(sessionId ?? "").trim();
  if (!normalized) {
    messages.value = [];
    return;
  }

  const token = ++messagesLoadToken;
  messagesLoading.value = true;
  try {
    const nextMessages = await getAiChatSessionMessages(normalized);
    if (disposed || token !== messagesLoadToken || activeSessionId.value !== normalized) {
      return;
    }
    messages.value = nextMessages;
    autoScrollEnabled.value = true;
    scrollMessagesToBottom(true);
  } catch (error) {
    if (token !== messagesLoadToken) {
      return;
    }
    panelStatus.value = "error";
    panelMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    if (token === messagesLoadToken) {
      messagesLoading.value = false;
    }
  }
}

async function handleCreateSession() {
  if (!canUseAiChat || sending.value) {
    return;
  }
  try {
    const session = await createAiChatSession();
    upsertSessionSummary(session);
    activeSessionId.value = session.id;
    messages.value = [];
    historyPanelOpen.value = false;
    panelStatus.value = "success";
    panelMessage.value = "已创建新会话。";
  } catch (error) {
    panelStatus.value = "error";
    panelMessage.value = error instanceof Error ? error.message : String(error);
  }
}

async function handleDeleteSession(sessionId: string) {
  if (!canUseAiChat || !sessionId || sending.value) {
    return;
  }
  if (!window.confirm("删除这个会话？此操作不可撤销。")) {
    return;
  }

  try {
    await deleteAiChatSession(sessionId);
    sessions.value = sessions.value.filter((item) => item.id !== sessionId);
    if (activeSessionId.value === sessionId) {
      activeSessionId.value = sessions.value[0]?.id ?? "";
      if (!activeSessionId.value) {
        messages.value = [];
      }
    }
    historyPanelOpen.value = false;
    panelStatus.value = "success";
    panelMessage.value = "会话已删除。";
  } catch (error) {
    panelStatus.value = "error";
    panelMessage.value = error instanceof Error ? error.message : String(error);
  }
}

async function handleSaveSettings() {
  if (!canUseAiChat) {
    return;
  }
  settingsSaving.value = true;
  try {
    const nextSettings = cloneAiChatSettings(
      await saveAiChatSettings(cloneAiChatSettings(settingsDraft.value)),
    );
    settings.value = nextSettings;
    settingsDraft.value = cloneAiChatSettings(nextSettings);
    settingsOpen.value = false;
    panelStatus.value = "success";
    panelMessage.value = "AI 设置已保存。";
  } catch (error) {
    panelStatus.value = "error";
    panelMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    settingsSaving.value = false;
  }
}

async function handleModelChange(event: Event) {
  const target = event.target as HTMLSelectElement | null;
  const nextModel = String(target?.value ?? "").trim();
  if (!nextModel || nextModel === settings.value.model.trim()) {
    return;
  }
  settingsSaving.value = true;
  try {
    const nextSettings = cloneAiChatSettings({
      ...settings.value,
      model: nextModel,
    });
    const saved = cloneAiChatSettings(await saveAiChatSettings(nextSettings));
    settings.value = saved;
    settingsDraft.value = cloneAiChatSettings(saved);
    panelStatus.value = "success";
    panelMessage.value = `当前模型已切换为 ${saved.model}。`;
  } catch (error) {
    panelStatus.value = "error";
    panelMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    settingsSaving.value = false;
  }
}

async function performSend(messageText: string, source: "manual" | "quick-launcher") {
  if (!canUseAiChat) {
    return;
  }
  const normalizedMessage = String(messageText ?? "").trim();
  if (!normalizedMessage && pendingAttachments.value.length === 0) {
    return;
  }

  sending.value = true;
  panelStatus.value = "loading";
  panelMessage.value = "正在请求 AI...";
  try {
    const payload = JSON.parse(JSON.stringify({
      sessionId: source === "quick-launcher" ? undefined : activeSessionId.value || undefined,
      message: normalizedMessage,
      attachments: cloneAiChatAttachments(pendingAttachments.value),
      attachmentsJson: JSON.stringify(cloneAiChatAttachments(pendingAttachments.value)),
      source,
    }));
    const result = await sendAiChatMessage({
      ...payload,
    });
    activeRequestId.value = result.requestId;
    upsertSessionSummary(result.session);
    activeSessionId.value = result.session.id;
    messages.value = [...messages.value.filter((item) => item.sessionId === result.session.id), result.userMessage, result.assistantMessage];
    await beginAiChatStream(result.requestId);
    if (source === "manual") {
      composer.value = "";
      pendingAttachments.value = [];
    }
    autoScrollEnabled.value = true;
    scrollMessagesToBottom(true);
  } catch (error) {
    panelStatus.value = "error";
    panelMessage.value = error instanceof Error ? error.message : String(error);
    sending.value = false;
  }
}

async function handleSendComposer() {
  if (!canSendMessage.value) {
    if (!hasConfiguredApi.value) {
      openSettingsDialog();
    }
    return;
  }
  await performSend(composer.value, "manual");
}

async function handleComposerKeydown(event: KeyboardEvent) {
  if (event.isComposing) {
    return;
  }
  if (event.key !== "Enter") {
    return;
  }
  if (!event.shiftKey) {
    return;
  }
  if (event.ctrlKey || event.altKey || event.metaKey) {
    return;
  }
  event.preventDefault();
  await handleSendComposer();
}

function createAttachmentId(): string {
  return `attachment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function readClipboardImage(file: File): Promise<AiChatImageAttachment> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Read clipboard image failed."));
    reader.readAsDataURL(file);
  });
  return {
    id: createAttachmentId(),
    dataUrl,
    mimeType: file.type || "image/png",
  };
}

async function handleComposerPaste(event: ClipboardEvent) {
  const items = Array.from(event.clipboardData?.items ?? []);
  const filesFromItems = items
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => !!file);
  const filesFromClipboard = Array.from(event.clipboardData?.files ?? []).filter((file) =>
    file.type.startsWith("image/"),
  );
  const imageFiles = [...filesFromItems, ...filesFromClipboard];
  if (imageFiles.length === 0) {
    return;
  }

  event.preventDefault();
  try {
    const nextAttachmentsRaw = await Promise.all(
      imageFiles.map((file) => readClipboardImage(file)),
    );
    const dedupedNewAttachments = Array.from(
      new Map(
        nextAttachmentsRaw.map((attachment) => [attachment.dataUrl, attachment]),
      ).values(),
    );
    const existingByDataUrl = new Set(
      pendingAttachments.value.map((attachment) => attachment.dataUrl),
    );
    pendingAttachments.value = [
      ...pendingAttachments.value,
      ...dedupedNewAttachments.filter((attachment) => !existingByDataUrl.has(attachment.dataUrl)),
    ];
  } catch (error) {
    panelStatus.value = "error";
    panelMessage.value = error instanceof Error ? error.message : String(error);
  }
}

function removePendingAttachment(attachmentId: string) {
  pendingAttachments.value = pendingAttachments.value.filter((item) => item.id !== attachmentId);
}

async function handleLaunchState(state: AiChatLaunchState | null | undefined) {
  const payload = String(state?.payload ?? "").trim();
  const updatedAt = Number(state?.updatedAt ?? 0);
  if (!payload || !updatedAt || updatedAt <= lastHandledLaunchUpdatedAt.value) {
    return;
  }
  lastHandledLaunchUpdatedAt.value = updatedAt;
  await performSend(payload, "quick-launcher");
}

function handleStreamEvent(event: AiChatStreamEvent) {
  const isCurrentRequest = activeRequestId.value === event.requestId;
  const session = sessions.value.find((item) => item.id === event.sessionId);
  if (session) {
    upsertSessionSummary({
      ...session,
      updatedAt: Date.now(),
    });
  }

  if (event.type === "delta" && typeof event.delta === "string" && activeSessionId.value === event.sessionId) {
    patchMessage(event.messageId, (message) => ({
      ...message,
      content: `${message.content}${event.delta}`,
      status: "streaming",
      updatedAt: Date.now(),
    }));
    scrollMessagesToBottom();
    return;
  }

  if (event.type === "done") {
    if (activeSessionId.value === event.sessionId) {
      patchMessage(event.messageId, (message) => ({
        ...message,
        status: "complete",
        errorMessage: null,
        updatedAt: Date.now(),
      }));
      scrollMessagesToBottom();
    }
    if (isCurrentRequest) {
      sending.value = false;
      activeRequestId.value = "";
      panelStatus.value = "success";
      panelMessage.value = "回复完成。";
    }
    return;
  }

  if (event.type === "error" || event.type === "canceled") {
    if (activeSessionId.value === event.sessionId) {
      patchMessage(event.messageId, (message) => ({
        ...message,
        status: "error",
        errorMessage: event.error ?? (event.type === "canceled" ? "Canceled by user." : "Request failed."),
        updatedAt: Date.now(),
      }));
      scrollMessagesToBottom();
    }
    if (isCurrentRequest) {
      sending.value = false;
      activeRequestId.value = "";
      panelStatus.value = event.type === "canceled" ? "idle" : "error";
      panelMessage.value = event.error ?? (event.type === "canceled" ? "已停止生成。" : "AI 请求失败。");
    }
  }
}

async function handleCancelStream() {
  if (!activeRequestId.value) {
    return;
  }
  try {
    await cancelAiChatStream(activeRequestId.value);
  } catch (error) {
    panelStatus.value = "error";
    panelMessage.value = error instanceof Error ? error.message : String(error);
  }
}

function handleSelectSession(sessionId: string) {
  activeSessionId.value = sessionId;
  historyPanelOpen.value = false;
}

watch(
  () => activeSessionId.value,
  (sessionId) => {
    if (!sessionId) {
      messages.value = [];
      return;
    }
    void loadMessages(sessionId);
  },
);

onMounted(async () => {
  disposed = false;
  await Promise.all([loadSettings(), loadSessions()]);
  if (settings.value.baseUrl && settings.value.apiKey) {
    void refreshModelsFromInput(settings.value);
  }
  unsubscribeStream = subscribeAiChatStream((event) => {
    handleStreamEvent(event);
  });
  unsubscribeLaunch = subscribeAiChatLaunch((state) => {
    void handleLaunchState(state);
  });
  try {
    const launchState = await getAiChatLaunchState();
    await handleLaunchState(launchState);
  } catch {
    // Ignore initial launch-state fetch errors and keep the panel usable.
  }
});

onBeforeUnmount(() => {
  disposed = true;
  unsubscribeStream?.();
  unsubscribeStream = null;
  unsubscribeLaunch?.();
  unsubscribeLaunch = null;
});
</script>

<template>
  <section
    class="grid h-full min-h-0 gap-4"
    :class="historyCollapsed ? 'lg:grid-cols-[64px_minmax(0,1fr)]' : 'lg:grid-cols-[320px_minmax(0,1fr)]'"
  >
    <aside class="hidden min-h-0 overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/60 p-3 lg:block">
      <div
        v-if="historyCollapsed"
        class="flex h-full flex-col items-center justify-start gap-3 py-2"
      >
        <button
          type="button"
          class="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700 bg-slate-950/80 text-slate-300 transition hover:border-emerald-400 hover:text-emerald-200"
          title="展开历史对话"
          @click="historyCollapsed = false"
        >
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" class="h-4 w-4">
            <path d="M7 4.5L12.5 10L7 15.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <span class="text-[11px] uppercase tracking-[0.16em] text-slate-500 [writing-mode:vertical-rl]">
          History
        </span>
      </div>

      <div
        v-else
        class="flex h-full min-h-0 flex-col"
      >
        <AiChatSessionList
          :sessions="sessions"
          :active-session-id="activeSessionId"
          :sessions-loading="sessionsLoading"
          :can-use-ai-chat="canUseAiChat"
          :sending="sending"
          :format-time="formatTime"
          :collapsible="true"
          @create="handleCreateSession"
          @collapse="historyCollapsed = true"
          @delete="handleDeleteSession"
          @select="handleSelectSession"
        />
      </div>
    </aside>

    <section class="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/60">
      <header class="shrink-0 flex flex-wrap items-start justify-between gap-3 border-b border-slate-700 px-4 py-4 sm:px-5">
        <div>
          <p class="text-xs uppercase tracking-[0.2em] text-emerald-300/80">AI Chat</p>
          <p class="mt-1 text-lg font-semibold text-slate-100">{{ activeSessionTitle }}</p>
        </div>
        <div class="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <button
            type="button"
            class="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 transition hover:border-emerald-400 hover:text-emerald-200 lg:hidden"
            @click="historyPanelOpen = true"
          >
            History
          </button>
          <span class="rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-slate-400">
            {{
              settings.provider === "anthropic-sdk"
                ? "Anthropic SDK"
                : settings.apiType === "responses"
                  ? "OpenAI Responses"
                  : "OpenAI Chat"
            }}
          </span>
          <select
            :value="settings.model"
            class="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-xs text-slate-100 outline-none transition focus:border-emerald-500/40 disabled:opacity-50 sm:max-w-[260px] sm:flex-none"
            :disabled="settingsSaving || sending || effectiveModelOptions.length === 0"
            @change="handleModelChange"
          >
            <option
              v-if="effectiveModelOptions.length === 0"
              value=""
            >
              No models
            </option>
            <option
              v-for="model in effectiveModelOptions"
              :key="model.id"
              :value="model.id"
            >
              {{ model.id }}
            </option>
          </select>
          <button
            v-if="activeRequestId"
            type="button"
            class="rounded-lg border border-amber-500/50 px-3 py-2 text-xs text-amber-200 transition hover:border-amber-400 hover:text-amber-100"
            @click="handleCancelStream"
          >
            Stop
          </button>
          <button
            type="button"
            class="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 transition hover:border-emerald-400 hover:text-emerald-200"
            @click="openSettingsDialog"
          >
            Settings
          </button>
        </div>
      </header>

      <div
        ref="messagesContainerRef"
        class="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5"
        @scroll="handleMessagesScroll"
      >
        <div
          v-if="messages.length === 0"
          class="rounded-2xl border border-dashed border-slate-700 bg-slate-950/60 px-5 py-10 text-center text-sm text-slate-500"
        >
          {{ emptyStateText }}
        </div>

        <AiChatMessageBubble
          v-for="message in messages"
          :key="message.id"
          :message="message"
          :formatted-time="formatTime(message.createdAt)"
        />
      </div>

      <footer class="shrink-0 border-t border-slate-700 px-4 py-4 sm:px-5">
        <div class="mb-3 flex items-center justify-between gap-3">
          <p
            class="text-xs"
            :class="
              panelStatus === 'error'
                ? 'text-rose-300'
                : panelStatus === 'loading'
                  ? 'text-amber-300'
                  : panelStatus === 'success'
                    ? 'text-emerald-300'
                    : 'text-slate-400'
            "
          >
            {{ panelMessage }}
          </p>
          <span
            v-if="activeRequestId"
            class="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-emerald-200"
          >
            streaming
          </span>
        </div>
        <div
          v-if="pendingAttachments.length > 0"
          class="mb-3 flex flex-wrap gap-2"
        >
          <div
            v-for="attachment in pendingAttachments"
            :key="attachment.id"
            class="group relative overflow-hidden rounded-xl border border-slate-700 bg-slate-950/80"
          >
            <img
              :src="attachment.dataUrl"
              alt=""
              class="h-20 w-20 object-cover"
            />
            <button
              type="button"
              class="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-700 bg-slate-950/90 text-[10px] text-slate-300 opacity-0 transition hover:border-rose-400 hover:text-rose-200 group-hover:opacity-100"
              @click="removePendingAttachment(attachment.id)"
            >
              ×
            </button>
          </div>
        </div>
        <div class="flex gap-3">
          <textarea
            v-model="composer"
            rows="4"
            class="min-h-[96px] flex-1 rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-emerald-500/40"
            placeholder="输入消息或直接粘贴图片，按 Shift+Enter 发送，Enter 换行"
            :disabled="!canUseAiChat || sending"
            @keydown.ctrl.enter.prevent="handleSendComposer"
            @keydown="handleComposerKeydown"
            @paste="handleComposerPaste"
          />
          <button
            type="button"
            class="self-end rounded-2xl bg-emerald-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="!canSendMessage"
            @click="handleSendComposer"
          >
            Send
          </button>
        </div>
      </footer>
    </section>

    <div
      v-if="historyPanelOpen"
      class="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm lg:hidden"
      @click.self="historyPanelOpen = false"
    >
      <aside class="absolute left-0 top-0 flex h-full w-[min(88vw,360px)] min-h-0 flex-col overflow-hidden border-r border-slate-700 bg-slate-950 px-4 py-4 shadow-2xl">
        <div class="mb-4 flex items-center justify-between gap-3">
          <p class="text-sm font-semibold text-slate-100">History</p>
          <button
            type="button"
            class="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
            @click="historyPanelOpen = false"
          >
            Close
          </button>
        </div>
        <AiChatSessionList
          :sessions="sessions"
          :active-session-id="activeSessionId"
          :sessions-loading="sessionsLoading"
          :can-use-ai-chat="canUseAiChat"
          :sending="sending"
          :format-time="formatTime"
          @create="handleCreateSession"
          @delete="handleDeleteSession"
          @select="handleSelectSession"
        />
      </aside>
    </div>

    <div
      v-if="settingsOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm"
      @click.self="settingsOpen = false"
    >
      <section class="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-950 p-5 shadow-2xl">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-lg font-semibold text-slate-100">AI Settings</p>
            <p class="mt-1 text-sm text-slate-400">
              配置 OpenAI 兼容接口地址、密钥和模型。
            </p>
          </div>
          <button
            type="button"
            class="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
            @click="settingsOpen = false"
          >
            Close
          </button>
        </div>

        <div class="mt-5 space-y-4">
          <label class="block text-sm text-slate-300">
            <span class="mb-1.5 block text-xs uppercase tracking-[0.18em] text-slate-500">Provider</span>
            <select
              v-model="settingsDraft.provider"
              class="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-emerald-500/40"
            >
              <option value="openai-sdk">OpenAI SDK</option>
              <option value="anthropic-sdk">Anthropic SDK</option>
            </select>
          </label>

          <label class="block text-sm text-slate-300">
            <span class="mb-1.5 block text-xs uppercase tracking-[0.18em] text-slate-500">API Type</span>
            <select
              v-model="settingsDraft.apiType"
              class="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-emerald-500/40"
              :disabled="settingsDraft.provider === 'anthropic-sdk'"
            >
              <option value="chat-completions">Chat Completions</option>
              <option value="responses">Responses</option>
            </select>
          </label>

          <label class="block text-sm text-slate-300">
            <span class="mb-1.5 block text-xs uppercase tracking-[0.18em] text-slate-500">API Base URL</span>
            <input
              v-model="settingsDraft.baseUrl"
              type="text"
              class="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-emerald-500/40"
              :placeholder="settingsDraft.provider === 'anthropic-sdk' ? '留空使用官方 Anthropic API，可选自定义代理地址' : '留空使用 OpenAI 官方 API，也可填写兼容服务地址'"
            />
          </label>

          <label class="block text-sm text-slate-300">
            <span class="mb-1.5 block text-xs uppercase tracking-[0.18em] text-slate-500">API Key</span>
            <input
              v-model="settingsDraft.apiKey"
              type="password"
              class="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-emerald-500/40"
              placeholder="sk-..."
            />
          </label>

          <label class="block text-sm text-slate-300">
            <span class="mb-1.5 block text-xs uppercase tracking-[0.18em] text-slate-500">Model</span>
            <div class="flex gap-3">
              <select
                v-model="settingsDraft.model"
                class="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-emerald-500/40"
              >
                <option
                  v-if="effectiveModelOptions.length === 0"
                  value=""
                >
                  No models loaded
                </option>
                <option
                  v-for="model in effectiveModelOptions"
                  :key="`settings-model-${model.id}`"
                  :value="model.id"
                >
                  {{ model.id }}
                </option>
              </select>
              <button
                type="button"
                class="shrink-0 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-emerald-400 hover:text-emerald-200 disabled:opacity-50"
                :disabled="modelsLoading"
                @click="handleRefreshModels"
              >
                {{ modelsLoading ? "Refreshing..." : "Refresh Models" }}
              </button>
            </div>
            <input
              v-model="settingsDraft.model"
              type="text"
              class="mt-3 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-emerald-500/40"
              placeholder="也可以手动输入模型名"
            />
          </label>

          <label class="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-slate-200">
            <input
              v-model="settingsDraft.debugEnabled"
              type="checkbox"
              class="h-4 w-4 rounded border-slate-600 bg-slate-950 text-emerald-400 focus:ring-emerald-400"
            />
            <span>开启 AI 调试日志（输出到启动应用的终端）</span>
          </label>
        </div>

        <div class="mt-5 flex justify-end gap-3">
          <button
            type="button"
            class="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
            @click="settingsOpen = false"
          >
            Cancel
          </button>
          <button
            type="button"
            class="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:opacity-50"
            :disabled="settingsSaving"
            @click="handleSaveSettings"
          >
            Save
          </button>
        </div>
      </section>
    </div>
  </section>
</template>
