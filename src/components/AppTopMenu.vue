<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  isElectronRuntime,
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
} from "../composables/launcher-history";
import type { InstalledApp } from "../types/app";
import type { SystemAppEntry } from "../types/system-app";
import type { TabDefinition } from "../types/settings";

interface LauncherResultItem {
  id: string;
  name: string;
  source: string;
  kind: "system" | "installed";
  targetId: string;
  score: number;
  acceptsLaunchPayload: boolean;
  historyKey: string;
  favorite: boolean;
  iconDataUrl?: string;
}

const props = defineProps<{
  tabs: TabDefinition[];
  activeTab: string;
  isSettingsActive: boolean;
  isGeneratorActive: boolean;
  isRuntimeActive: boolean;
  installedApps: InstalledApp[];
}>();

const emit = defineEmits<{
  select: [tabId: string];
  generator: [];
  runtime: [];
  settings: [];
}>();

const SEARCH_LIMIT = 12;
const SYSTEM_SEARCH_LIMIT = 20;
const INSTALLED_SEARCH_LIMIT = 20;

const canSearchApps = isElectronRuntime();
const launcherRootRef = ref<HTMLElement | null>(null);
const launcherQuery = ref("");
const launcherResults = ref<LauncherResultItem[]>([]);
const launcherStatus = ref<"idle" | "loading" | "error">("idle");
const launcherMessage = ref("");
const launcherPanelOpen = ref(false);
const launcherActiveIndex = ref(-1);
const launcherPayloadTarget = ref<LauncherResultItem | null>(null);
const launcherHistoryByKey = ref(readLauncherHistoryMap());

let launcherSearchTimer: ReturnType<typeof setTimeout> | null = null;
let launcherSearchToken = 0;
let launcherQueryBeforePayload = "";
let unsubscribeLauncherHistory: (() => void) | null = null;

const launcherPlaceholder = computed(() => {
  if (launcherPayloadTarget.value) {
    return `Type launch payload for ${launcherPayloadTarget.value.name}...`;
  }
  return canSearchApps
    ? "Search system and installed apps..."
    : "App search available in Electron";
});

const launcherEmptyText = computed(() => {
  if (launcherStatus.value === "loading") {
    return "Searching...";
  }
  if (launcherStatus.value === "error") {
    return launcherMessage.value || "Search failed.";
  }
  if (!launcherQuery.value.trim()) {
    return "Type app name to search. Recent launches are shown here.";
  }
  return "No matching apps.";
});

function resetLauncherResults() {
  launcherResults.value = [];
  launcherActiveIndex.value = -1;
  launcherStatus.value = "idle";
}

function refreshLauncherHistory() {
  launcherHistoryByKey.value = readLauncherHistoryMap();
}

function buildRecentLauncherResults(): LauncherResultItem[] {
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
      score: 500 + computeLauncherHistoryBoost(item),
      acceptsLaunchPayload: item.acceptsLaunchPayload,
      historyKey,
      favorite: item.favorite,
    });
  }

  return output.slice(0, SEARCH_LIMIT);
}

function showRecentLauncherResults() {
  const recent = buildRecentLauncherResults();
  launcherResults.value = recent;
  launcherActiveIndex.value = recent.length > 0 ? 0 : -1;
  launcherStatus.value = "idle";
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function computeInstalledScore(app: InstalledApp, normalizedQuery: string, tokens: string[]): number {
  const normalizedName = app.name.toLowerCase();
  const normalizedId = app.id.toLowerCase();
  const normalizedTabId = app.tabId.toLowerCase();
  const combined = `${normalizedName} ${normalizedId} ${normalizedTabId}`;

  let score = 0;

  if (normalizedName === normalizedQuery) {
    score += 260;
  } else if (normalizedName.startsWith(normalizedQuery)) {
    score += 210;
  } else if (normalizedName.includes(normalizedQuery)) {
    score += 160;
  }

  if (normalizedId === normalizedQuery) {
    score += 180;
  } else if (normalizedId.startsWith(normalizedQuery)) {
    score += 130;
  } else if (normalizedId.includes(normalizedQuery)) {
    score += 90;
  }

  if (normalizedTabId.includes(normalizedQuery)) {
    score += 40;
  }

  for (let i = 0; i < tokens.length; i += 1) {
    if (combined.includes(tokens[i])) {
      score += 20;
    }
  }

  return score;
}

function searchInstalledApps(query: string): LauncherResultItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  const tokens = tokenizeQuery(normalizedQuery);

  const scored = props.installedApps
    .map((app) => {
      const score = computeInstalledScore(app, normalizedQuery, tokens);
      return { app, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (a.score !== b.score) {
        return b.score - a.score;
      }
      return a.app.name.localeCompare(b.app.name);
    })
    .slice(0, INSTALLED_SEARCH_LIMIT);

  return scored.map(({ app, score }) => ({
    historyKey: makeLauncherHistoryKey("installed", app.id),
    favorite: launcherHistoryByKey.value.get(makeLauncherHistoryKey("installed", app.id))?.favorite === true,
    id: `installed:${app.id}`,
    kind: "installed",
    targetId: app.id,
    name: app.name,
    source: app.running ? "Installed / Running" : "Installed",
    score:
      score +
      computeLauncherHistoryBoost(
        launcherHistoryByKey.value.get(makeLauncherHistoryKey("installed", app.id)),
      ),
    acceptsLaunchPayload: true,
  }));
}

async function runLauncherSearch() {
  if (!canSearchApps) {
    return;
  }
  if (launcherPayloadTarget.value) {
    return;
  }

  const query = launcherQuery.value.trim();
  const token = ++launcherSearchToken;
  if (!query) {
    showRecentLauncherResults();
    return;
  }

  launcherStatus.value = "loading";
  launcherMessage.value = "";
  launcherPanelOpen.value = true;

  const installedResults = searchInstalledApps(query);

  try {
    const systemResults = await searchSystemApps(query, SYSTEM_SEARCH_LIMIT);
    if (token !== launcherSearchToken) {
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

    launcherResults.value = mergedResults;
    launcherActiveIndex.value = mergedResults.length > 0 ? 0 : -1;
    launcherStatus.value = "idle";
  } catch (error) {
    if (token !== launcherSearchToken) {
      return;
    }

    if (installedResults.length > 0) {
      launcherResults.value = installedResults.slice(0, SEARCH_LIMIT);
      launcherActiveIndex.value = 0;
      launcherStatus.value = "idle";
      return;
    }

    launcherStatus.value = "error";
    launcherMessage.value = error instanceof Error ? error.message : String(error);
    launcherResults.value = [];
    launcherActiveIndex.value = -1;
  }
}

function scheduleLauncherSearch() {
  if (launcherSearchTimer) {
    clearTimeout(launcherSearchTimer);
  }
  launcherSearchTimer = setTimeout(() => {
    void runLauncherSearch();
  }, 180);
}

function clearLauncher() {
  launcherQuery.value = "";
  launcherPayloadTarget.value = null;
  launcherQueryBeforePayload = "";
  launcherPanelOpen.value = false;
  launcherSearchToken += 1;
  resetLauncherResults();
}

watch(launcherQuery, () => {
  if (!canSearchApps) {
    return;
  }
  if (launcherPayloadTarget.value) {
    return;
  }
  if (!launcherPanelOpen.value && !launcherQuery.value.trim()) {
    return;
  }

  launcherPanelOpen.value = true;
  if (!launcherQuery.value.trim()) {
    launcherSearchToken += 1;
    showRecentLauncherResults();
    return;
  }

  launcherStatus.value = "loading";
  launcherResults.value = [];
  launcherActiveIndex.value = -1;
  scheduleLauncherSearch();
});

watch(
  () => props.installedApps,
  () => {
    if (launcherPayloadTarget.value) {
      return;
    }
    if (!launcherPanelOpen.value) {
      return;
    }
    if (!launcherQuery.value.trim()) {
      showRecentLauncherResults();
      return;
    }
    scheduleLauncherSearch();
  },
);

function moveLauncherSelection(step: number) {
  const count = launcherResults.value.length;
  if (count === 0) {
    launcherActiveIndex.value = -1;
    return;
  }

  const current = launcherActiveIndex.value < 0 ? 0 : launcherActiveIndex.value;
  launcherActiveIndex.value = (current + step + count) % count;
}

async function openLauncherItem(index: number) {
  if (!canSearchApps) {
    return;
  }

  const target = launcherResults.value[index];
  if (!target) {
    return;
  }

  await executeLauncherTarget(target, undefined);
}

async function executeLauncherTarget(target: LauncherResultItem, launchPayload?: string) {
  launcherPanelOpen.value = false;
  try {
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
    });
    refreshLauncherHistory();
    clearLauncher();
  } catch (error) {
    launcherStatus.value = "error";
    launcherMessage.value = error instanceof Error ? error.message : String(error);
  }
}

function handleLauncherResultContextMenu(
  result: LauncherResultItem,
  event: MouseEvent,
) {
  event.preventDefault();
  const nextFavorite = toggleLauncherFavorite(result.historyKey);
  refreshLauncherHistory();
  launcherMessage.value = nextFavorite
    ? `Favorited: ${result.name}`
    : `Unfavorited: ${result.name}`;
  if (!launcherQuery.value.trim()) {
    showRecentLauncherResults();
  } else {
    scheduleLauncherSearch();
  }
}

function activateLauncherPayloadTarget(index: number) {
  const target = launcherResults.value[index];
  if (!target || !target.acceptsLaunchPayload) {
    return;
  }
  launcherQueryBeforePayload = launcherQuery.value.trim();
  launcherPayloadTarget.value = target;
  launcherQuery.value = "";
  launcherMessage.value = "";
  launcherPanelOpen.value = false;
  resetLauncherResults();
}

function cancelLauncherPayloadTarget() {
  const restoreQuery = launcherQueryBeforePayload;
  launcherPayloadTarget.value = null;
  launcherQueryBeforePayload = "";
  launcherQuery.value = restoreQuery;
}

function handleLauncherKeydown(event: KeyboardEvent) {
  if (!canSearchApps) {
    return;
  }
  if (event.isComposing) {
    return;
  }

  if (event.key === "ArrowDown") {
    if (launcherPayloadTarget.value) {
      return;
    }
    event.preventDefault();
    launcherPanelOpen.value = true;
    moveLauncherSelection(1);
    return;
  }

  if (event.key === "ArrowUp") {
    if (launcherPayloadTarget.value) {
      return;
    }
    event.preventDefault();
    launcherPanelOpen.value = true;
    moveLauncherSelection(-1);
    return;
  }

  if (event.key === " ") {
    if (!launcherPayloadTarget.value && launcherActiveIndex.value >= 0) {
      event.preventDefault();
      activateLauncherPayloadTarget(launcherActiveIndex.value);
    }
    return;
  }

  if (event.key === "Backspace" && launcherPayloadTarget.value && !launcherQuery.value) {
    event.preventDefault();
    cancelLauncherPayloadTarget();
    return;
  }

  if (event.key === "Enter") {
    if (launcherPayloadTarget.value) {
      event.preventDefault();
      void executeLauncherTarget(launcherPayloadTarget.value, launcherQuery.value);
      return;
    }
    if (launcherPanelOpen.value && launcherActiveIndex.value >= 0) {
      event.preventDefault();
      void openLauncherItem(launcherActiveIndex.value);
    }
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    if (launcherPayloadTarget.value) {
      cancelLauncherPayloadTarget();
      return;
    }
    clearLauncher();
  }
}

function handleLauncherFocus() {
  if (!canSearchApps) {
    return;
  }
  if (launcherPayloadTarget.value) {
    return;
  }
  launcherPanelOpen.value = true;
  if (!launcherQuery.value.trim()) {
    showRecentLauncherResults();
    return;
  }
  scheduleLauncherSearch();
}

function handleGlobalPointerDown(event: PointerEvent) {
  const root = launcherRootRef.value;
  if (!root || !(event.target instanceof Node)) {
    return;
  }
  if (!root.contains(event.target)) {
    launcherPanelOpen.value = false;
  }
}

onMounted(() => {
  refreshLauncherHistory();
  unsubscribeLauncherHistory = subscribeLauncherHistoryUpdates(() => {
    refreshLauncherHistory();
    if (
      launcherPanelOpen.value &&
      !launcherPayloadTarget.value &&
      !launcherQuery.value.trim()
    ) {
      showRecentLauncherResults();
    }
  });
  window.addEventListener("pointerdown", handleGlobalPointerDown);
});

onBeforeUnmount(() => {
  unsubscribeLauncherHistory?.();
  unsubscribeLauncherHistory = null;
  window.removeEventListener("pointerdown", handleGlobalPointerDown);
  if (launcherSearchTimer) {
    clearTimeout(launcherSearchTimer);
    launcherSearchTimer = null;
  }
});
</script>

<template>
  <header
    class="sticky top-0 z-30 border-b border-slate-800/70 bg-slate-950/80 backdrop-blur-xl"
  >
    <div class="mx-auto w-full max-w-7xl px-4 pb-2 pt-3 md:px-6">
      <div class="flex flex-wrap items-center gap-3">
        <div class="flex min-w-0 items-center gap-3">
          <div
            class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-300 to-sky-500 text-xs font-bold text-slate-950"
          >
            TH
          </div>
          <div class="min-w-0 leading-tight">
            <p class="text-sm font-semibold text-slate-100">Tool Hub</p>
            <p class="hidden text-xs text-slate-400 sm:block">Workspace</p>
          </div>
        </div>

        <div
          ref="launcherRootRef"
          class="relative min-w-[220px] flex-1"
        >
          <input
            v-model="launcherQuery"
            type="text"
            class="w-full rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-500/40 transition focus:border-slate-600 focus:ring disabled:cursor-not-allowed disabled:opacity-70"
            :placeholder="launcherPlaceholder"
            :disabled="!canSearchApps"
            @keydown="handleLauncherKeydown"
            @focus="handleLauncherFocus"
          />

          <div
            v-if="launcherPanelOpen && canSearchApps && !launcherPayloadTarget"
            class="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-40 overflow-hidden rounded-xl border border-slate-700 bg-slate-950/95 shadow-2xl backdrop-blur"
          >
            <div
              v-if="launcherResults.length > 0"
              class="max-h-72 overflow-y-auto py-1"
            >
              <button
                v-for="(app, index) in launcherResults"
                :key="app.id"
                type="button"
                class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition"
                :class="
                  launcherActiveIndex === index
                    ? 'bg-cyan-500/15 text-cyan-100'
                    : 'text-slate-200 hover:bg-slate-900 hover:text-slate-100'
                "
                @mouseenter="launcherActiveIndex = index"
                @click="openLauncherItem(index)"
                @contextmenu="handleLauncherResultContextMenu(app, $event)"
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
                  <span class="truncate">{{ app.name }}</span>
                </span>
                <span class="shrink-0 text-xs text-slate-400">
                  {{ app.favorite ? "★ " : "" }}{{ app.source }}
                </span>
              </button>
            </div>
            <p
              v-if="launcherResults.length > 0"
              class="border-t border-slate-800 px-3 py-2 text-xs text-slate-500"
            >
              Tip: right-click a result to toggle favorite.
            </p>
            <p
              v-if="launcherResults.length === 0"
              class="px-3 py-2 text-xs text-slate-400"
            >
              {{ launcherEmptyText }}
            </p>
          </div>
          <p
            v-if="launcherPayloadTarget"
            class="mt-2 text-xs text-cyan-300"
          >
            Selected: {{ launcherPayloadTarget.name }}. Type payload and press Enter.
            Press Backspace on empty input to cancel.
          </p>
        </div>

        <div class="inline-flex items-center gap-1 rounded-xl bg-slate-900/70 p-1 ring-1 ring-slate-700/80">
          <button
            type="button"
            class="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
            :class="
              props.isGeneratorActive
                ? 'bg-cyan-500/15 text-cyan-100 ring-1 ring-cyan-500/40'
                : 'text-slate-300 hover:bg-slate-800/80 hover:text-slate-100'
            "
            @click="emit('generator')"
          >
            Generator
          </button>
          <button
            type="button"
            class="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
            :class="
              props.isRuntimeActive
                ? 'bg-cyan-500/15 text-cyan-100 ring-1 ring-cyan-500/40'
                : 'text-slate-300 hover:bg-slate-800/80 hover:text-slate-100'
            "
            @click="emit('runtime')"
          >
            Runtime
          </button>
          <button
            type="button"
            class="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
            :class="
              props.isSettingsActive
                ? 'bg-cyan-500/15 text-cyan-100 ring-1 ring-cyan-500/40'
                : 'text-slate-300 hover:bg-slate-800/80 hover:text-slate-100'
            "
            @click="emit('settings')"
          >
            Settings
          </button>
        </div>
      </div>

      <nav class="mt-3 overflow-x-auto pb-1">
        <div class="inline-flex items-center gap-1.5 rounded-xl bg-slate-900/50 p-1 ring-1 ring-slate-800/70">
          <button
            v-for="tab in props.tabs"
            :key="tab.id"
            type="button"
            class="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
            :class="
              props.activeTab === tab.id
                ? 'bg-cyan-500/15 text-cyan-100 ring-1 ring-cyan-500/40'
                : 'text-slate-300 hover:bg-slate-800/80 hover:text-slate-100'
            "
            @click="emit('select', tab.id)"
          >
            {{ tab.label }}
          </button>
        </div>
      </nav>
    </div>
  </header>
</template>
