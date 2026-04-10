<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  getQuickLauncherClipboardPathContext,
  getSystemAppsByIds,
  isElectronRuntime,
  openClipboardPathFile,
  openClipboardPathLocation,
  openAppWindow,
  openSystemApp,
  searchSystemApps,
  startApp,
} from "../platform/electron-bridge";
import {
  computeLauncherHistoryBoost,
  getRecentLauncherHistory,
  makeLauncherHistoryKey,
  readLauncherHistoryMap,
  recordLauncherLaunch,
  subscribeLauncherHistoryUpdates,
  toggleLauncherFavorite,
  upsertLauncherHistoryIcons,
} from "../composables/launcher-history";
import { searchInstalledLauncherApps } from "../composables/launcher-search";
import type { ClipboardPathContext, InstalledApp } from "../types/app";
import type { SystemAppEntry } from "../types/system-app";

interface LauncherResultItem {
  id: string;
  name: string;
  source: string;
  kind: "system" | "installed" | "clipboard-path";
  targetId: string;
  score: number;
  acceptsLaunchPayload: boolean;
  historyKey: string | null;
  favorite: boolean;
  iconDataUrl?: string;
  description?: string;
  clipboardAction?: "open-file" | "open-path";
}

interface QuickLauncherSizePayload {
  mode: "compact" | "expanded";
  resultCount: number;
  showEmptyState: boolean;
  showPayloadHint: boolean;
  contentHeight?: number;
}

const props = defineProps<{
  open: boolean;
  installedApps: InstalledApp[];
  embedded?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  sizeMode: [payload: QuickLauncherSizePayload];
}>();

const SEARCH_LIMIT = 12;
const SYSTEM_SEARCH_LIMIT = 10;
const INSTALLED_SEARCH_LIMIT = 20;
const ICON_BACKFILL_LIMIT = 50;
const ICON_BACKFILL_RETRY_MS = 5 * 60 * 1000;
const FIRST_QUERY_SEARCH_DEBOUNCE_MS = 0;
const SUBSEQUENT_SEARCH_DEBOUNCE_MS = 90;

const canSearchApps = isElectronRuntime();
const modalRootRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);
const query = ref("");
const results = ref<LauncherResultItem[]>([]);
const status = ref<"idle" | "loading" | "error">("idle");
const message = ref("");
const activeIndex = ref(-1);
const launchPayloadTarget = ref<LauncherResultItem | null>(null);
const launcherHistoryByKey = ref(readLauncherHistoryMap());
const clipboardPathContext = ref<ClipboardPathContext | null>(null);

let searchTimer: ReturnType<typeof setTimeout> | null = null;
let searchToken = 0;
let clipboardPathToken = 0;
let searchQueryBeforePayload = "";
let unsubscribeLauncherHistory: (() => void) | null = null;
const recentIconBackfillInFlight = new Set<string>();
const recentIconBackfillAttemptAt = new Map<string, number>();
let disposed = false;

const clipboardPathHint = computed(() => {
  if (launchPayloadTarget.value || query.value.trim()) {
    return "";
  }
  return clipboardPathContext.value?.path ?? "";
});

const placeholder = computed(() => {
  if (launchPayloadTarget.value) {
    return `Type launch payload for ${launchPayloadTarget.value.name}...`;
  }
  if (clipboardPathHint.value) {
    return "";
  }
  return canSearchApps
    ? "Search system and installed apps..."
    : "App search available in Electron";
});

const showFavoriteTip = computed(() => results.value.some((item) => !!item.historyKey));

const windowSizePayload = computed<QuickLauncherSizePayload>(() => {
  const hasQuery = query.value.trim().length > 0;
  const hasResults = results.value.length > 0 && launchPayloadTarget.value === null;
  const showEmptyState =
    launchPayloadTarget.value === null &&
    !hasResults &&
    (status.value === "loading" || status.value === "error" || hasQuery);
  const showPayloadHint = launchPayloadTarget.value !== null;

  if (!props.embedded) {
    return {
      mode: "expanded",
      resultCount: hasResults ? results.value.length : 0,
      showEmptyState,
      showPayloadHint,
    };
  }
  return {
    mode: hasResults || showEmptyState || showPayloadHint ? "expanded" : "compact",
    resultCount: hasResults ? results.value.length : 0,
    showEmptyState,
    showPayloadHint,
  };
});

const wrapperClass = computed(() => {
  if (props.embedded) {
    return "mx-auto w-full";
  }
  return "fixed inset-0 z-50 flex items-start justify-center bg-slate-950/55 px-4 pt-[14vh] backdrop-blur-sm";
});

const panelClass = computed(() => {
  if (props.embedded) {
    return "w-full px-1 py-1";
  }
  return "w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-700 bg-slate-950/95 shadow-2xl";
});

const inputContainerClass = computed(() => {
  if (props.embedded) {
    return "px-0 py-0";
  }
  return "px-4 py-4";
});

const resultsPanelClass = computed(() => {
  if (props.embedded) {
    return "mt-1 h-[256px] overflow-y-auto rounded-xl border border-slate-700 bg-slate-950/95 shadow-2xl";
  }
  return "max-h-[56vh] overflow-y-auto py-1";
});

const emptyText = computed(() => {
  if (status.value === "loading") {
    return "Searching...";
  }
  if (status.value === "error") {
    return message.value || "Search failed.";
  }
  if (!query.value.trim()) {
    return "Type app name to search. Recent launches are shown here.";
  }
  return "No matching apps.";
});

function resetResults() {
  results.value = [];
  activeIndex.value = -1;
  status.value = "idle";
}

function refreshLauncherHistory() {
  launcherHistoryByKey.value = readLauncherHistoryMap();
}

function buildClipboardPathResults(): LauncherResultItem[] {
  const context = clipboardPathContext.value;
  if (!context || query.value.trim() || launchPayloadTarget.value) {
    return [];
  }

  const targetKindLabel = context.kind === "directory" ? "Directory" : "File";
  if (context.kind === "directory") {
    return [
      {
        id: `clipboard-path:open-path:${context.path}`,
        kind: "clipboard-path",
        targetId: context.path,
        name: "Open Path",
        description: context.path,
        source: "Clipboard / Open directory",
        score: 4000,
        acceptsLaunchPayload: false,
        historyKey: null,
        favorite: false,
        clipboardAction: "open-path",
      },
    ];
  }

  return [
    {
      id: `clipboard-path:open-file:${context.path}`,
      kind: "clipboard-path",
      targetId: context.path,
      name: "Open File",
      description: context.path,
      source: `Clipboard / ${targetKindLabel}`,
      score: 4000,
      acceptsLaunchPayload: false,
      historyKey: null,
      favorite: false,
      clipboardAction: "open-file",
    },
    {
      id: `clipboard-path:open-path:${context.path}`,
      kind: "clipboard-path",
      targetId: context.path,
      name: "Open Path",
      description: context.path,
      source: "Clipboard / Reveal in Explorer",
      score: 3990,
      acceptsLaunchPayload: false,
      historyKey: null,
      favorite: false,
      clipboardAction: "open-path",
    },
  ];
}

function buildRecentResults(): LauncherResultItem[] {
  const installedById = new Map(props.installedApps.map((app) => [app.id, app]));
  const recent = getRecentLauncherHistory(SEARCH_LIMIT);
  const output: LauncherResultItem[] = [];

  for (let i = 0; i < recent.length; i += 1) {
    const item = recent[i];
    const historyKey = makeLauncherHistoryKey(item.kind, item.targetId);
    if (item.kind === "installed") {
      const installed = installedById.get(item.targetId);
      if (!installed) {
        continue;
      }
      output.push({
        id: `installed:${installed.id}`,
        kind: "installed",
        targetId: installed.id,
        name: installed.name,
        source: installed.running ? "Recent / Installed / Running" : "Recent / Installed",
        score: 500 + computeLauncherHistoryBoost(item),
        acceptsLaunchPayload: true,
        historyKey,
        favorite: item.favorite,
      });
      continue;
    }

    output.push({
      id: `system:${item.targetId}`,
      kind: "system",
      targetId: item.targetId,
      name: item.name,
      source: `Recent / ${item.source}`,
      iconDataUrl: item.iconDataUrl,
      score: 500 + computeLauncherHistoryBoost(item),
      acceptsLaunchPayload: item.acceptsLaunchPayload,
      historyKey,
      favorite: item.favorite,
    });
  }

  return output.slice(0, SEARCH_LIMIT);
}

function buildDefaultResults(): LauncherResultItem[] {
  const clipboardResults = buildClipboardPathResults();
  const remaining = Math.max(0, SEARCH_LIMIT - clipboardResults.length);
  if (remaining === 0) {
    return clipboardResults.slice(0, SEARCH_LIMIT);
  }
  return [...clipboardResults, ...buildRecentResults().slice(0, remaining)];
}

async function runRecentSystemIconBackfill(systemIds: string[]) {
  if (systemIds.length === 0 || disposed) {
    return;
  }

  try {
    const entries = await getSystemAppsByIds(systemIds);
    if (disposed || entries.length === 0) {
      return;
    }
    const iconByHistoryKey = new Map<string, string>();
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      const iconDataUrl = String(entry.iconDataUrl ?? "").trim();
      if (!iconDataUrl) {
        continue;
      }
      iconByHistoryKey.set(makeLauncherHistoryKey("system", entry.id), iconDataUrl);
    }
    if (iconByHistoryKey.size > 0) {
      upsertLauncherHistoryIcons(iconByHistoryKey);
    }
  } catch {
    // Ignore icon backfill failures and keep launcher responsive.
  } finally {
    systemIds.forEach((id) => {
      recentIconBackfillInFlight.delete(id);
    });
  }
}

function backfillRecentSystemIcons(items: LauncherResultItem[]) {
  if (!canSearchApps || disposed) {
    return;
  }

  const now = Date.now();
  const targetIds: string[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item.kind !== "system" || item.iconDataUrl) {
      continue;
    }
    const targetId = item.targetId.trim();
    if (!targetId || recentIconBackfillInFlight.has(targetId)) {
      continue;
    }
    const lastAttemptAt = recentIconBackfillAttemptAt.get(targetId) ?? 0;
    if (now - lastAttemptAt < ICON_BACKFILL_RETRY_MS) {
      continue;
    }
    recentIconBackfillInFlight.add(targetId);
    recentIconBackfillAttemptAt.set(targetId, now);
    targetIds.push(targetId);
    if (targetIds.length >= ICON_BACKFILL_LIMIT) {
      break;
    }
  }

  if (targetIds.length > 0) {
    void runRecentSystemIconBackfill(targetIds);
  }
}

function collectPendingSystemIconIds(items: LauncherResultItem[], limit: number): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item.kind !== "system" || item.iconDataUrl) {
      continue;
    }
    const targetId = item.targetId.trim();
    if (!targetId || seen.has(targetId)) {
      continue;
    }
    seen.add(targetId);
    output.push(targetId);
    if (output.length >= limit) {
      break;
    }
  }
  return output;
}

async function runSearchSystemIconBackfill(systemIds: string[], token: number) {
  if (systemIds.length === 0 || disposed) {
    return;
  }

  try {
    const entries = await getSystemAppsByIds(systemIds);
    if (
      disposed ||
      token !== searchToken ||
      !props.open ||
      launchPayloadTarget.value ||
      entries.length === 0
    ) {
      return;
    }

    const iconByTargetId = new Map<string, string>();
    const iconByHistoryKey = new Map<string, string>();
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      const iconDataUrl = String(entry.iconDataUrl ?? "").trim();
      if (!iconDataUrl) {
        continue;
      }
      iconByTargetId.set(entry.id, iconDataUrl);
      iconByHistoryKey.set(makeLauncherHistoryKey("system", entry.id), iconDataUrl);
    }
    if (iconByTargetId.size === 0) {
      return;
    }

    results.value = results.value.map((item) => {
      if (item.kind !== "system") {
        return item;
      }
      const iconDataUrl = iconByTargetId.get(item.targetId);
      if (!iconDataUrl || item.iconDataUrl === iconDataUrl) {
        return item;
      }
      return {
        ...item,
        iconDataUrl,
      };
    });
    if (iconByHistoryKey.size > 0) {
      upsertLauncherHistoryIcons(iconByHistoryKey);
    }
  } catch {
    // Ignore icon backfill failures and keep launcher responsive.
  }
}

function backfillSearchSystemIcons(items: LauncherResultItem[], token: number) {
  const targetIds = collectPendingSystemIconIds(items, SYSTEM_SEARCH_LIMIT);
  if (targetIds.length > 0) {
    void runSearchSystemIconBackfill(targetIds, token);
  }
}

function showDefaultResults() {
  const nextResults = buildDefaultResults();
  results.value = nextResults;
  activeIndex.value = nextResults.length > 0 ? 0 : -1;
  status.value = "idle";
  backfillRecentSystemIcons(nextResults);
}

function clearSearch() {
  query.value = "";
  message.value = "";
  launchPayloadTarget.value = null;
  searchQueryBeforePayload = "";
  searchToken += 1;
  resetResults();
}

function closeModal() {
  emit("close");
}

function updateMeasuredContentHeight() {
  // Removed - no longer using measured content height
}

function searchInstalledApps(input: string): LauncherResultItem[] {
  return searchInstalledLauncherApps({
    installedApps: props.installedApps,
    historyByKey: launcherHistoryByKey.value,
    query: input,
    limit: INSTALLED_SEARCH_LIMIT,
  });
}

async function runSearch() {
  if (!canSearchApps || !props.open) {
    return;
  }
  if (launchPayloadTarget.value) {
    return;
  }

  const trimmedQuery = query.value.trim();
  const token = ++searchToken;
  if (!trimmedQuery) {
    showDefaultResults();
    return;
  }

  status.value = "loading";
  message.value = "";

  const installedResults = searchInstalledApps(trimmedQuery);

  try {
    const systemResults = await searchSystemApps(trimmedQuery, SYSTEM_SEARCH_LIMIT);
    if (token !== searchToken) {
      return;
    }

    const mappedSystemResults: LauncherResultItem[] = systemResults.map(
      (app: SystemAppEntry, index) => {
        const historyKey = makeLauncherHistoryKey("system", app.id);
        const history = launcherHistoryByKey.value.get(historyKey);
        return {
          id: `system:${app.id}`,
          kind: "system",
          targetId: app.id,
          name: app.name,
          source: app.source,
          iconDataUrl: app.iconDataUrl,
          score: 180 - index + computeLauncherHistoryBoost(history),
          acceptsLaunchPayload: !!app.acceptsLaunchPayload,
          historyKey,
          favorite: history?.favorite === true,
        };
      },
    );

    const mergedResults = [...installedResults, ...mappedSystemResults]
      .sort((a, b) => {
        if (a.score !== b.score) {
          return b.score - a.score;
        }
        return a.name.localeCompare(b.name);
      })
      .slice(0, SEARCH_LIMIT);

    results.value = mergedResults;
    activeIndex.value = mergedResults.length > 0 ? 0 : -1;
    status.value = "idle";
    backfillSearchSystemIcons(mergedResults, token);
  } catch (error) {
    if (token !== searchToken) {
      return;
    }

    if (installedResults.length > 0) {
      results.value = installedResults.slice(0, SEARCH_LIMIT);
      activeIndex.value = 0;
      status.value = "idle";
      return;
    }

    status.value = "error";
    message.value = error instanceof Error ? error.message : String(error);
    results.value = [];
    activeIndex.value = -1;
  }
}

function scheduleSearch() {
  if (searchTimer) {
    clearTimeout(searchTimer);
  }
  const nextDelay = query.value.trim().length <= 1
    ? FIRST_QUERY_SEARCH_DEBOUNCE_MS
    : SUBSEQUENT_SEARCH_DEBOUNCE_MS;
  searchTimer = setTimeout(() => {
    void runSearch();
  }, nextDelay);
}

function moveSelection(step: number) {
  const count = results.value.length;
  if (count === 0) {
    activeIndex.value = -1;
    return;
  }

  const current = activeIndex.value < 0 ? 0 : activeIndex.value;
  activeIndex.value = (current + step + count) % count;
}

async function openResult(index: number) {
  if (!canSearchApps) {
    return;
  }

  const target = results.value[index];
  if (!target) {
    return;
  }

  await executeLaunchTarget(target, undefined);
}

async function executeLaunchTarget(target: LauncherResultItem, launchPayload?: string) {
  try {
    if (target.kind === "clipboard-path") {
      if (target.clipboardAction === "open-path") {
        await openClipboardPathLocation(target.targetId);
      } else {
        await openClipboardPathFile(target.targetId);
      }
      clearSearch();
      closeModal();
      return;
    }

    if (target.kind === "system") {
      await openSystemApp(target.targetId, launchPayload);
    } else {
      await startApp(target.targetId);
      await openAppWindow(target.targetId, {
        source: "quick-launcher",
        payload: launchPayload,
      });
    }
    recordLauncherLaunch({
      kind: target.kind,
      targetId: target.targetId,
      name: target.name,
      source: target.source,
      acceptsLaunchPayload: target.acceptsLaunchPayload,
      iconDataUrl: target.iconDataUrl,
    });
    refreshLauncherHistory();
    clearSearch();
    closeModal();
  } catch (error) {
    status.value = "error";
    message.value = error instanceof Error ? error.message : String(error);
  }
}

function handleResultContextMenu(target: LauncherResultItem, event: MouseEvent) {
  event.preventDefault();
  if (!target.historyKey) {
    return;
  }
  const nextFavorite = toggleLauncherFavorite(target.historyKey);
  refreshLauncherHistory();
  message.value = nextFavorite
    ? `Favorited: ${target.name}`
    : `Unfavorited: ${target.name}`;
  if (!query.value.trim()) {
    showDefaultResults();
  } else {
    scheduleSearch();
  }
}

function activateLaunchPayloadTarget(index: number) {
  const target = results.value[index];
  if (!target || !target.acceptsLaunchPayload) {
    return;
  }
  searchQueryBeforePayload = query.value.trim();
  launchPayloadTarget.value = target;
  query.value = "";
  message.value = "";
  resetResults();
}

function cancelLaunchPayloadTarget() {
  const restoreQuery = searchQueryBeforePayload;
  launchPayloadTarget.value = null;
  searchQueryBeforePayload = "";
  query.value = restoreQuery;
}

async function refreshClipboardPathContext() {
  if (!canSearchApps || disposed) {
    clipboardPathContext.value = null;
    return;
  }

  const token = ++clipboardPathToken;
  try {
    const nextContext = await getQuickLauncherClipboardPathContext();
    if (disposed || token !== clipboardPathToken) {
      return;
    }
    clipboardPathContext.value = nextContext;
  } catch {
    if (token !== clipboardPathToken) {
      return;
    }
    clipboardPathContext.value = null;
  }
}

async function refreshClipboardPathContextAndShowDefaults() {
  await refreshClipboardPathContext();
  if (!props.open || launchPayloadTarget.value || query.value.trim()) {
    return;
  }
  showDefaultResults();
}

function handleInputKeydown(event: KeyboardEvent) {
  if (event.isComposing) {
    return;
  }

  if (event.key === "ArrowDown") {
    if (launchPayloadTarget.value) {
      return;
    }
    event.preventDefault();
    moveSelection(1);
    return;
  }

  if (event.key === "ArrowUp") {
    if (launchPayloadTarget.value) {
      return;
    }
    event.preventDefault();
    moveSelection(-1);
    return;
  }

  if (event.key === " ") {
    if (!launchPayloadTarget.value && activeIndex.value >= 0) {
      event.preventDefault();
      activateLaunchPayloadTarget(activeIndex.value);
    }
    return;
  }

  if (event.key === "Backspace" && launchPayloadTarget.value && !query.value) {
    event.preventDefault();
    cancelLaunchPayloadTarget();
    return;
  }

  if (event.key === "Enter") {
    if (launchPayloadTarget.value) {
      event.preventDefault();
      void executeLaunchTarget(launchPayloadTarget.value, query.value);
      return;
    }
    if (activeIndex.value >= 0) {
      event.preventDefault();
      void openResult(activeIndex.value);
    }
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    if (launchPayloadTarget.value) {
      cancelLaunchPayloadTarget();
      return;
    }
    clearSearch();
    closeModal();
  }
}

watch(query, () => {
  if (!props.open || !canSearchApps) {
    return;
  }
  if (launchPayloadTarget.value) {
    return;
  }

  if (!query.value.trim()) {
    searchToken += 1;
    clipboardPathContext.value = null;
    showDefaultResults();
    void refreshClipboardPathContextAndShowDefaults();
    return;
  }

  status.value = "loading";
  results.value = [];
  activeIndex.value = -1;
  scheduleSearch();
});

watch(
  () => props.installedApps,
  () => {
    if (launchPayloadTarget.value) {
      return;
    }
    if (!props.open) {
      return;
    }
    if (!query.value.trim()) {
      showDefaultResults();
      return;
    }
    scheduleSearch();
  },
);

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      clearSearch();
      return;
    }
    await nextTick();
    inputRef.value?.focus();
    inputRef.value?.select();
    if (!query.value.trim() && !launchPayloadTarget.value) {
      await refreshClipboardPathContextAndShowDefaults();
    }
  },
);

watch(
  () => windowSizePayload.value,
  (payload) => {
    if (!props.open || !props.embedded) {
      return;
    }
    emit("sizeMode", payload);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  disposed = true;
  unsubscribeLauncherHistory?.();
  unsubscribeLauncherHistory = null;
  if (searchTimer) {
    clearTimeout(searchTimer);
    searchTimer = null;
  }
});

onMounted(async () => {
  disposed = false;
  refreshLauncherHistory();
  unsubscribeLauncherHistory = subscribeLauncherHistoryUpdates(() => {
    refreshLauncherHistory();
    if (props.open && !launchPayloadTarget.value && !query.value.trim()) {
      showDefaultResults();
    }
  });
  if (props.open) {
    await nextTick();
    inputRef.value?.focus();
    inputRef.value?.select();
    await refreshClipboardPathContextAndShowDefaults();
  }
});
</script>

<template>
  <div
    v-if="props.open"
    ref="modalRootRef"
    :class="wrapperClass"
    @click.self="!props.embedded && closeModal()"
  >
    <section
      :class="panelClass"
    >
      <div :class="inputContainerClass">
        <div class="relative">
          <div
            v-if="clipboardPathHint"
            class="pointer-events-none absolute inset-0 flex items-center overflow-hidden rounded-lg px-3 py-2.5 text-sm text-slate-500/70"
          >
            <span class="truncate">{{ clipboardPathHint }}</span>
          </div>
          <input
            ref="inputRef"
            v-model="query"
            type="text"
            class="relative z-10 w-full rounded-lg bg-slate-900/50 px-3 py-2.5 text-sm text-slate-100 outline-none ring-2 ring-transparent transition focus:bg-slate-900/70 focus:ring-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-70"
            :placeholder="placeholder"
            :disabled="!canSearchApps"
            @keydown="handleInputKeydown"
          />
        </div>
        <p
          v-if="launchPayloadTarget"
          class="mt-1.5 text-xs text-cyan-300"
        >
          Selected: {{ launchPayloadTarget.name }}. Type payload and press Enter.
          Press Backspace on empty input to cancel.
        </p>
        <p
          v-else-if="!props.embedded"
          class="mt-1.5 text-xs text-slate-500"
        >
          Shortcut: Alt + Space. Press Space to select highlighted app for payload input.
        </p>
      </div>

      <div
        v-if="results.length > 0 && !launchPayloadTarget"
        :class="resultsPanelClass"
      >
        <button
          v-for="(app, index) in results"
          :key="app.id"
          type="button"
          class="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm transition first:pt-2.5 last:pb-2.5"
          :class="
            activeIndex === index
              ? 'bg-cyan-500/15 text-cyan-100'
              : 'text-slate-200 hover:bg-slate-900 hover:text-slate-100'
          "
          @mouseenter="activeIndex = index"
          @click="openResult(index)"
          @contextmenu="handleResultContextMenu(app, $event)"
        >
          <span class="flex min-w-0 items-center gap-2">
            <span
              class="inline-flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-800 text-[10px] font-semibold text-slate-200"
            >
              <img
                v-if="app.iconDataUrl"
                :src="app.iconDataUrl"
                alt=""
                class="h-5 w-5 object-contain"
              />
              <span v-else>{{ app.name.slice(0, 1) }}</span>
            </span>
            <span class="min-w-0">
              <span class="block truncate">{{ app.name }}</span>
              <span
                v-if="app.description"
                class="block truncate text-xs text-slate-500"
              >
                {{ app.description }}
              </span>
            </span>
          </span>
          <span class="shrink-0 text-xs text-slate-400">
            {{ app.favorite ? "★ " : "" }}{{ app.source }}
          </span>
        </button>
        <p
          v-if="showFavoriteTip"
          class="sticky bottom-0 border-t border-slate-800 bg-slate-950/95 px-4 py-2 text-xs text-slate-500"
        >
          Tip: right-click a result to toggle favorite.
        </p>
      </div>

      <p
        v-if="
          results.length === 0 &&
          !launchPayloadTarget &&
          (!props.embedded || windowSizePayload.mode === 'expanded')
        "
        :class="props.embedded ? 'mt-1 rounded-xl border border-slate-700 bg-slate-950/95 px-4 py-4 text-xs text-slate-400 shadow-2xl' : 'px-4 py-4 text-xs text-slate-400'"
      >
        {{ emptyText }}
      </p>
    </section>
  </div>
</template>
