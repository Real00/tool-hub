<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  isElectronRuntime,
  openAppWindow,
  openSystemApp,
  searchSystemApps,
  startApp,
} from "../platform/electron-bridge";
import type { InstalledApp } from "../types/app";
import type { SystemAppEntry } from "../types/system-app";

interface LauncherResultItem {
  id: string;
  name: string;
  source: string;
  kind: "system" | "installed";
  targetId: string;
  score: number;
  acceptsLaunchPayload: boolean;
  iconDataUrl?: string;
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
const SYSTEM_SEARCH_LIMIT = 20;
const INSTALLED_SEARCH_LIMIT = 20;

const canSearchApps = isElectronRuntime();
const modalRootRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);
const query = ref("");
const results = ref<LauncherResultItem[]>([]);
const status = ref<"idle" | "loading" | "error">("idle");
const message = ref("");
const activeIndex = ref(-1);
const launchPayloadTarget = ref<LauncherResultItem | null>(null);

let searchTimer: ReturnType<typeof setTimeout> | null = null;
let searchToken = 0;
let searchQueryBeforePayload = "";

const placeholder = computed(() => {
  if (launchPayloadTarget.value) {
    return `Type launch payload for ${launchPayloadTarget.value.name}...`;
  }
  return canSearchApps
    ? "Search system and installed apps..."
    : "App search available in Electron";
});

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
  return "border-b border-slate-800 px-4 py-3";
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
    return "Type app name to search.";
  }
  return "No matching apps.";
});

function resetResults() {
  results.value = [];
  activeIndex.value = -1;
  status.value = "idle";
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

function tokenizeQuery(input: string): string[] {
  return input
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

function searchInstalledApps(input: string): LauncherResultItem[] {
  const normalizedQuery = input.trim().toLowerCase();
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
    id: `installed:${app.id}`,
    kind: "installed",
    targetId: app.id,
    name: app.name,
    source: app.running ? "Installed / Running" : "Installed",
    score,
    acceptsLaunchPayload: true,
  }));
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
    resetResults();
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
      (app: SystemAppEntry, index) => ({
        id: `system:${app.id}`,
        kind: "system",
        targetId: app.id,
        name: app.name,
        source: app.source,
        iconDataUrl: app.iconDataUrl,
        score: 180 - index,
        acceptsLaunchPayload: !!app.acceptsLaunchPayload,
      }),
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
  searchTimer = setTimeout(() => {
    void runSearch();
  }, 150);
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
    if (target.kind === "system") {
      await openSystemApp(target.targetId, launchPayload);
    } else {
      await startApp(target.targetId);
      await openAppWindow(target.targetId, launchPayload);
    }
    clearSearch();
    closeModal();
  } catch (error) {
    status.value = "error";
    message.value = error instanceof Error ? error.message : String(error);
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
    resetResults();
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
    if (!props.open || !query.value.trim()) {
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
  if (searchTimer) {
    clearTimeout(searchTimer);
    searchTimer = null;
  }
});

onMounted(async () => {
  if (props.open) {
    await nextTick();
    inputRef.value?.focus();
    inputRef.value?.select();
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
        <input
          ref="inputRef"
          v-model="query"
          type="text"
          class="w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2.5 text-sm text-slate-100 outline-none ring-cyan-500/40 transition focus:border-slate-600 focus:ring disabled:cursor-not-allowed disabled:opacity-70"
          :placeholder="placeholder"
          :disabled="!canSearchApps"
          @keydown="handleInputKeydown"
        />
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
          <span class="shrink-0 text-xs text-slate-400">{{ app.source }}</span>
        </button>
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
