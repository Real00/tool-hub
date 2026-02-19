<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import AppTopMenu from "../components/AppTopMenu.vue";
import { defaultTabs } from "../config/settings";
import type { AppsRootInfo, InstalledApp } from "../types/app";
import type { TabDefinition } from "../types/settings";
import {
  getAppLogs,
  getAppsRoot,
  getSettingsTabs,
  initializeAppsDatabase,
  initializeSettingsDatabase,
  installAppFromDirectory,
  isElectronRuntime,
  listApps,
  openAppWindow,
  pickInstallDirectory,
  pingBackend,
  removeApp,
  saveSettingsTabs,
  startApp,
  stopApp,
} from "../platform/electron-bridge";

const tabs = ref<TabDefinition[]>(defaultTabs.map((tab) => ({ ...tab })));
const apps = ref<InstalledApp[]>([]);
const activeTab = ref(defaultTabs[0]?.id ?? "");
const showSettingsPanel = ref(false);
const showOverview = ref(false);
const runtimeLabel = ref("Web");

const bridgeStatus = ref<"idle" | "loading" | "success" | "error">("idle");
const bridgeMessage = ref("Electron backend not connected yet.");

const settingsStatus = ref<"idle" | "saving" | "success" | "error">("idle");
const settingsMessage = ref("Edit tabs and save to local SQLite.");
const tabDraft = ref<TabDefinition[]>([]);

const appsStatus = ref<"idle" | "loading" | "success" | "error">("idle");
const appsMessage = ref("Node apps are loaded from the fixed user directory.");
const installSourceDir = ref("");
const installTabId = ref(defaultTabs[0]?.id ?? "workspace");
const appsRootInfo = ref<AppsRootInfo | null>(null);

const logsStatus = ref<"idle" | "loading" | "success" | "error">("idle");
const appLogs = ref<string[]>([]);
const logsAppId = ref<string | null>(null);

let appsPollingTimer: ReturnType<typeof setInterval> | null = null;
let appsInitialLoadTimer: ReturnType<typeof setTimeout> | null = null;
let bridgeAndTabsLoadTimer: ReturnType<typeof setTimeout> | null = null;

const activeTabLabel = computed(() => {
  return tabs.value.find((tab) => tab.id === activeTab.value)?.label ?? "Unknown";
});

const appsInActiveTab = computed(() => {
  return apps.value.filter((app) => app.tabId === activeTab.value);
});

const logsAppName = computed(() => {
  if (!logsAppId.value) {
    return "";
  }
  return apps.value.find((item) => item.id === logsAppId.value)?.name ?? logsAppId.value;
});

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function normalizeTabId(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeTabs(input: TabDefinition[]): TabDefinition[] {
  const seen = new Set<string>();
  const output: TabDefinition[] = [];

  for (let i = 0; i < input.length; i += 1) {
    const item = input[i];
    const label = item.label.trim();
    if (!label) {
      continue;
    }

    const normalizedId = normalizeTabId(item.id || label);
    if (!normalizedId || seen.has(normalizedId)) {
      continue;
    }

    seen.add(normalizedId);
    output.push({ id: normalizedId, label });
  }

  return output;
}

function cloneTabs(input: TabDefinition[]): TabDefinition[] {
  return input.map((tab) => ({ ...tab }));
}

function applyTabs(input: TabDefinition[]) {
  const normalized = normalizeTabs(input);
  tabs.value = normalized.length > 0 ? normalized : cloneTabs(defaultTabs);
  if (!tabs.value.some((tab) => tab.id === activeTab.value)) {
    activeTab.value = tabs.value[0]?.id ?? "";
  }
  if (!tabs.value.some((tab) => tab.id === installTabId.value)) {
    installTabId.value = tabs.value[0]?.id ?? "workspace";
  }
  tabDraft.value = cloneTabs(tabs.value);
}

function applyApps(input: InstalledApp[]) {
  apps.value = [...input].sort((a, b) => {
    if (a.tabId !== b.tabId) {
      return a.tabId.localeCompare(b.tabId);
    }
    return a.name.localeCompare(b.name);
  });
}

async function loadTabsFromStorage() {
  if (!isElectronRuntime()) {
    applyTabs(defaultTabs);
    settingsMessage.value = "Browser mode: tabs are editable but not persisted to SQLite.";
    settingsStatus.value = "idle";
    return;
  }

  try {
    const storedTabs = await getSettingsTabs();
    applyTabs(storedTabs);
    settingsMessage.value = "Tabs loaded from local SQLite.";
    settingsStatus.value = "idle";
  } catch (error) {
    applyTabs(defaultTabs);
    settingsStatus.value = "error";
    settingsMessage.value = `Load failed: ${formatError(error)}`;
  }
}

async function loadAppsData() {
  if (!isElectronRuntime()) {
    applyApps([]);
    appsRootInfo.value = null;
    appsStatus.value = "idle";
    appsMessage.value = "Browser mode: Node apps are unavailable.";
    return;
  }

  appsStatus.value = "loading";
  try {
    const [rootInfo, list] = await Promise.all([getAppsRoot(), listApps()]);
    appsRootInfo.value = rootInfo;
    applyApps(list);
    appsStatus.value = "success";
    appsMessage.value = `Found ${list.length} app(s).`;
  } catch (error) {
    appsStatus.value = "error";
    appsMessage.value = `Load failed: ${formatError(error)}`;
  }
}

async function testElectronBridge() {
  if (!isElectronRuntime()) {
    bridgeStatus.value = "idle";
    bridgeMessage.value = "Current runtime is browser-only. Start via `pnpm electron:dev`.";
    return;
  }

  bridgeStatus.value = "loading";
  try {
    const result = await pingBackend("tool-hub");
    bridgeStatus.value = "success";
    bridgeMessage.value = result;
  } catch (error) {
    bridgeStatus.value = "error";
    bridgeMessage.value = `Ping failed: ${formatError(error)}`;
  }
}

function toggleSettingsPanel() {
  showSettingsPanel.value = !showSettingsPanel.value;
  if (showSettingsPanel.value) {
    tabDraft.value = cloneTabs(tabs.value);
    settingsStatus.value = "idle";
    settingsMessage.value = "Edit tabs and save to local SQLite.";
  }
}

function addTabRow() {
  tabDraft.value.push({
    id: `tab-${Date.now().toString(36)}`,
    label: "New Tab",
  });
}

function removeTabRow(index: number) {
  tabDraft.value.splice(index, 1);
}

function autofillTabId(index: number) {
  const row = tabDraft.value[index];
  if (!row) {
    return;
  }
  if (row.id.trim()) {
    row.id = normalizeTabId(row.id);
    return;
  }
  row.id = normalizeTabId(row.label);
}

async function saveTabsToStorage() {
  const normalized = normalizeTabs(tabDraft.value);
  if (normalized.length === 0) {
    settingsStatus.value = "error";
    settingsMessage.value = "At least one valid tab is required.";
    return;
  }

  if (!isElectronRuntime()) {
    applyTabs(normalized);
    settingsStatus.value = "success";
    settingsMessage.value = "Saved in browser memory only.";
    return;
  }

  settingsStatus.value = "saving";
  settingsMessage.value = "Saving to local SQLite...";

  try {
    const savedTabs = await saveSettingsTabs(normalized);
    applyTabs(savedTabs);
    settingsStatus.value = "success";
    settingsMessage.value = "Saved to local SQLite successfully.";
  } catch (error) {
    settingsStatus.value = "error";
    settingsMessage.value = `Save failed: ${formatError(error)}`;
  }
}

async function initializeSettingsDb() {
  if (!isElectronRuntime()) {
    settingsStatus.value = "error";
    settingsMessage.value = "Initialize DB is only available in Electron runtime.";
    return;
  }

  settingsStatus.value = "saving";
  settingsMessage.value = "Initializing settings database...";

  try {
    const storedTabs = await initializeSettingsDatabase();
    applyTabs(storedTabs);
    settingsStatus.value = "success";
    settingsMessage.value = "Settings database initialized.";
  } catch (error) {
    settingsStatus.value = "error";
    settingsMessage.value = `Initialize failed: ${formatError(error)}`;
  }
}

async function installNodeApp() {
  if (!isElectronRuntime()) {
    appsStatus.value = "error";
    appsMessage.value = "Install is only available in Electron runtime.";
    return;
  }
  if (!installSourceDir.value.trim()) {
    appsStatus.value = "error";
    appsMessage.value = "Please provide a source directory path.";
    return;
  }
  if (!installTabId.value) {
    appsStatus.value = "error";
    appsMessage.value = "Please choose a target tab.";
    return;
  }

  appsStatus.value = "loading";
  appsMessage.value = `Installing app into tab "${installTabId.value}"...`;

  try {
    const list = await installAppFromDirectory(installSourceDir.value.trim(), installTabId.value);
    applyApps(list);
    appsStatus.value = "success";
    appsMessage.value = `App installed successfully (tabId=${installTabId.value}).`;
    installSourceDir.value = "";
  } catch (error) {
    appsStatus.value = "error";
    appsMessage.value = `Install failed: ${formatError(error)}`;
  }
}

async function chooseInstallDirectory() {
  if (!isElectronRuntime()) {
    appsStatus.value = "error";
    appsMessage.value = "Directory picker is only available in Electron runtime.";
    return;
  }

  try {
    const selected = await pickInstallDirectory();
    if (!selected) {
      return;
    }
    installSourceDir.value = selected;
    appsStatus.value = "idle";
    appsMessage.value = "Source directory selected.";
  } catch (error) {
    appsStatus.value = "error";
    appsMessage.value = `Pick directory failed: ${formatError(error)}`;
  }
}

async function initializeAppsDb() {
  if (!isElectronRuntime()) {
    appsStatus.value = "error";
    appsMessage.value = "Initialize DB is only available in Electron runtime.";
    return;
  }

  appsStatus.value = "loading";
  appsMessage.value = "Initializing apps database...";

  try {
    const list = await initializeAppsDatabase();
    applyApps(list);
    appsStatus.value = "success";
    appsMessage.value = `Apps database initialized. Found ${list.length} app(s).`;
  } catch (error) {
    appsStatus.value = "error";
    appsMessage.value = `Initialize failed: ${formatError(error)}`;
  }
}

async function removeNodeApp(appId: string) {
  if (!isElectronRuntime()) {
    appsStatus.value = "error";
    appsMessage.value = "Remove is only available in Electron runtime.";
    return;
  }

  if (!window.confirm(`Remove app "${appId}"? This will delete its folder from apps root.`)) {
    return;
  }

  appsStatus.value = "loading";
  appsMessage.value = `Removing app: ${appId}...`;

  try {
    const list = await removeApp(appId);
    applyApps(list);
    if (logsAppId.value === appId) {
      logsAppId.value = null;
      appLogs.value = [];
      logsStatus.value = "idle";
    }
    appsStatus.value = "success";
    appsMessage.value = `App removed: ${appId}`;
  } catch (error) {
    appsStatus.value = "error";
    appsMessage.value = `Remove failed: ${formatError(error)}`;
  }
}

async function startNodeApp(appId: string) {
  appsStatus.value = "loading";
  try {
    const list = await startApp(appId);
    applyApps(list);
    appsStatus.value = "success";
    appsMessage.value = `App started: ${appId}`;
    await loadAppLogs(appId);
  } catch (error) {
    appsStatus.value = "error";
    appsMessage.value = `Start failed: ${formatError(error)}`;
  }
}

async function stopNodeApp(appId: string) {
  appsStatus.value = "loading";
  try {
    const list = await stopApp(appId);
    applyApps(list);
    appsStatus.value = "success";
    appsMessage.value = `App stopped: ${appId}`;
    await loadAppLogs(appId);
  } catch (error) {
    appsStatus.value = "error";
    appsMessage.value = `Stop failed: ${formatError(error)}`;
  }
}

async function openNodeAppWindow(appId: string) {
  try {
    await openAppWindow(appId);
    appsStatus.value = "success";
    appsMessage.value = `Opened app window: ${appId}`;
  } catch (error) {
    appsStatus.value = "error";
    appsMessage.value = `Open window failed: ${formatError(error)}`;
  }
}

async function loadAppLogs(appId?: string | null) {
  const targetAppId = appId ?? logsAppId.value;
  if (!targetAppId || !isElectronRuntime()) {
    appLogs.value = [];
    logsAppId.value = null;
    return;
  }

  logsAppId.value = targetAppId;
  logsStatus.value = "loading";
  try {
    appLogs.value = await getAppLogs(targetAppId);
    logsStatus.value = "success";
  } catch (error) {
    logsStatus.value = "error";
    appLogs.value = [`Log load failed: ${formatError(error)}`];
  }
}

function startAppsPolling() {
  if (appsPollingTimer) {
    clearInterval(appsPollingTimer);
  }
  appsPollingTimer = setInterval(() => {
    void loadAppsData();
    if (logsAppId.value) {
      void loadAppLogs(logsAppId.value);
    }
  }, 4000);
}

onMounted(() => {
  runtimeLabel.value = isElectronRuntime() ? "Electron" : "Web";
  bridgeAndTabsLoadTimer = setTimeout(() => {
    void loadTabsFromStorage();
    void testElectronBridge();
  }, 120);

  appsInitialLoadTimer = setTimeout(() => {
    void loadAppsData();
    startAppsPolling();
  }, 1200);
});

onUnmounted(() => {
  if (bridgeAndTabsLoadTimer) {
    clearTimeout(bridgeAndTabsLoadTimer);
    bridgeAndTabsLoadTimer = null;
  }
  if (appsInitialLoadTimer) {
    clearTimeout(appsInitialLoadTimer);
    appsInitialLoadTimer = null;
  }
  if (appsPollingTimer) {
    clearInterval(appsPollingTimer);
    appsPollingTimer = null;
  }
});
</script>

<template>
  <div class="relative min-h-screen bg-slate-950 text-slate-100">
    <div class="pointer-events-none absolute inset-0 bg-mesh-glow opacity-70" />

    <AppTopMenu
      :tabs="tabs"
      :active-tab="activeTab"
      @select="activeTab = $event"
      @settings="toggleSettingsPanel"
    />

    <main class="relative mx-auto w-full max-w-7xl px-4 pb-10 pt-7 md:px-6">
      <section class="rounded-2xl border border-slate-800/70 bg-slate-900/60 p-4 backdrop-blur-sm">
        <div class="flex flex-wrap items-center gap-2">
          <span class="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-200">
            Runtime: {{ runtimeLabel }}
          </span>
          <span
            class="rounded-md px-2 py-1 text-xs"
            :class="
              bridgeStatus === 'success'
                ? 'bg-emerald-500/20 text-emerald-200'
                : bridgeStatus === 'error'
                  ? 'bg-rose-500/20 text-rose-200'
                  : bridgeStatus === 'loading'
                    ? 'bg-amber-500/20 text-amber-200'
                    : 'bg-slate-800 text-slate-300'
            "
          >
            {{ bridgeStatus }}
          </span>
          <button
            type="button"
            class="rounded-md border border-slate-600 px-2.5 py-1 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
            @click="testElectronBridge"
          >
            Test Bridge
          </button>
          <button
            type="button"
            class="rounded-md border border-slate-600 px-2.5 py-1 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
            @click="showOverview = !showOverview"
          >
            {{ showOverview ? "Hide Overview" : "Show Overview" }}
          </button>
        </div>
        <p class="mt-2 text-xs text-slate-400">{{ bridgeMessage }}</p>
        <div
          v-if="showOverview"
          class="mt-3 rounded-xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-300"
        >
          Top tabs are category definitions. App-to-tab binding is persisted in local
          SQLite, and opening an app launches its UI in a new window.
        </div>
      </section>

      <section
        class="mt-6 rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-6"
      >
        <p class="text-xs uppercase tracking-[0.2em] text-cyan-300/90">
          Active Category
        </p>
        <p class="mt-2 text-xl font-semibold text-slate-100">
          {{ activeTabLabel }}
        </p>
        <p class="mt-2 text-sm text-slate-400">
          App count in this tab: {{ appsInActiveTab.length }}
        </p>
      </section>

      <section class="mt-6 grid gap-3 md:grid-cols-2">
        <article
          v-for="appItem in appsInActiveTab"
          :key="appItem.id"
          class="rounded-2xl border border-slate-700 bg-slate-900/55 p-4"
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-base font-semibold text-slate-100">{{ appItem.name }}</p>
              <p class="mt-1 text-xs text-slate-400">
                {{ appItem.id }} · v{{ appItem.version }}
              </p>
              <p class="mt-2 text-xs text-slate-500">
                {{ appItem.appDir }}
              </p>
            </div>
            <span
              class="rounded-md px-2 py-1 text-xs"
              :class="
                appItem.running
                  ? 'bg-emerald-500/20 text-emerald-200'
                  : 'bg-slate-800 text-slate-300'
              "
            >
              {{ appItem.running ? `running (${appItem.pid ?? '-'})` : "stopped" }}
            </span>
          </div>
          <div class="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded-md border border-slate-600 px-2.5 py-1.5 text-xs transition hover:border-cyan-400 hover:text-cyan-200"
              @click="openNodeAppWindow(appItem.id)"
            >
              Open Window
            </button>
            <button
              v-if="!appItem.running"
              type="button"
              class="rounded-md bg-emerald-500 px-2.5 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-emerald-400"
              @click="startNodeApp(appItem.id)"
            >
              Start
            </button>
            <button
              v-else
              type="button"
              class="rounded-md bg-rose-500 px-2.5 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-rose-400"
              @click="stopNodeApp(appItem.id)"
            >
              Stop
            </button>
            <button
              type="button"
              class="rounded-md border border-slate-600 px-2.5 py-1.5 text-xs transition hover:border-cyan-400 hover:text-cyan-200"
              @click="loadAppLogs(appItem.id)"
            >
              Logs
            </button>
            <button
              type="button"
              class="rounded-md border border-rose-500/40 px-2.5 py-1.5 text-xs text-rose-200 transition hover:border-rose-400 hover:text-rose-100"
              @click="removeNodeApp(appItem.id)"
            >
              Remove
            </button>
          </div>
        </article>
        <article
          v-if="appsInActiveTab.length === 0"
          class="rounded-2xl border border-slate-700 bg-slate-900/55 p-5 text-sm text-slate-400"
        >
          No apps bound to this tab yet. Install an app to this tab from Settings and
          refresh apps.
        </article>
      </section>

      <section class="mt-6 rounded-xl border border-slate-700 bg-slate-950/80 p-4">
        <div class="flex items-center justify-between">
          <p class="text-sm font-medium text-slate-100">
            Runtime logs {{ logsAppName ? `(${logsAppName})` : "" }}
          </p>
          <span
            class="rounded-md px-2 py-1 text-xs"
            :class="
              logsStatus === 'error'
                ? 'bg-rose-500/20 text-rose-200'
                : logsStatus === 'loading'
                  ? 'bg-amber-500/20 text-amber-200'
                  : 'bg-slate-800 text-slate-300'
            "
          >
            {{ logsStatus }}
          </span>
        </div>
        <pre class="mt-3 max-h-56 overflow-auto whitespace-pre-wrap text-xs text-slate-300">{{ appLogs.join('\n') || 'No logs selected.' }}</pre>
      </section>

      <section
        v-if="showSettingsPanel"
        class="mt-6 rounded-2xl border border-slate-700 bg-slate-900/60 p-6"
      >
        <div class="flex flex-wrap items-center justify-between gap-3">
          <p class="text-sm font-medium text-slate-100">Settings: Tab definitions</p>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
              @click="loadTabsFromStorage"
            >
              Reload
            </button>
            <button
              type="button"
              class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
              @click="addTabRow"
            >
              Add Tab
            </button>
            <button
              type="button"
              class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
              @click="initializeSettingsDb"
            >
              Init DB
            </button>
            <button
              type="button"
              class="rounded-lg bg-cyan-400 px-3 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-cyan-300"
              @click="saveTabsToStorage"
            >
              Save
            </button>
          </div>
        </div>
        <p class="mt-2 text-sm text-slate-400">
          Built-in tab definitions are persisted to local SQLite.
        </p>

        <div class="mt-4 space-y-2">
          <div
            v-for="(tab, index) in tabDraft"
            :key="`${tab.id}-${index}`"
            class="grid gap-2 rounded-lg border border-slate-700 bg-slate-950/60 p-3 md:grid-cols-[1fr_1fr_auto]"
          >
            <input
              v-model="tab.label"
              type="text"
              placeholder="Tab label"
              class="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-500/50 placeholder:text-slate-500 focus:ring"
              @blur="autofillTabId(index)"
            />
            <input
              v-model="tab.id"
              type="text"
              placeholder="tab-id"
              class="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-500/50 placeholder:text-slate-500 focus:ring"
            />
            <button
              type="button"
              class="rounded-md border border-rose-500/40 px-3 py-2 text-xs text-rose-200 transition hover:border-rose-400 hover:text-rose-100"
              @click="removeTabRow(index)"
            >
              Remove
            </button>
          </div>
        </div>

        <div class="mt-4 flex items-center gap-3 text-xs">
          <span
            class="rounded-md px-2 py-1"
            :class="
              settingsStatus === 'success'
                ? 'bg-emerald-500/20 text-emerald-200'
                : settingsStatus === 'error'
                  ? 'bg-rose-500/20 text-rose-200'
                  : settingsStatus === 'saving'
                    ? 'bg-amber-500/20 text-amber-200'
                    : 'bg-slate-800 text-slate-300'
            "
          >
            {{ settingsStatus }}
          </span>
          <span class="text-slate-300">{{ settingsMessage }}</span>
        </div>

        <hr class="my-6 border-slate-700" />

        <div class="flex flex-wrap items-center justify-between gap-3">
          <p class="text-sm font-medium text-slate-100">Node apps management</p>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
              @click="loadAppsData"
            >
              Refresh Apps
            </button>
            <button
              type="button"
              class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
              @click="initializeAppsDb"
            >
              Init DB
            </button>
          </div>
        </div>
        <p class="mt-2 text-sm text-slate-400">
          Apps root: <code>{{ appsRootInfo?.appsRoot ?? "-" }}</code><br />
          Apps DB: <code>{{ appsRootInfo?.dbPath ?? "-" }}</code><br />
          App category is persisted in local SQLite (<code>apps.tab_id</code>). The tab
          selected below will be written to database at install time.
        </p>

        <div class="mt-4 grid gap-2 md:grid-cols-[1fr_220px_auto_auto]">
          <input
            v-model="installSourceDir"
            type="text"
            placeholder="Source directory with app.json (e.g. D:\\apps\\hello-app)"
            class="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-500/50 placeholder:text-slate-500 focus:ring"
          />
          <select
            v-model="installTabId"
            class="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-500/50 focus:ring"
          >
            <option
              v-for="tab in tabs"
              :key="`install-tab-${tab.id}`"
              :value="tab.id"
            >
              {{ tab.label }} ({{ tab.id }})
            </option>
          </select>
          <button
            type="button"
            class="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
            @click="chooseInstallDirectory"
          >
            Select Dir
          </button>
          <button
            type="button"
            class="rounded-lg bg-cyan-400 px-3 py-2 text-xs font-semibold text-slate-900 transition hover:bg-cyan-300"
            @click="installNodeApp"
          >
            Install App
          </button>
        </div>

        <div class="mt-4 flex items-center gap-3 text-xs">
          <span
            class="rounded-md px-2 py-1"
            :class="
              appsStatus === 'success'
                ? 'bg-emerald-500/20 text-emerald-200'
                : appsStatus === 'error'
                  ? 'bg-rose-500/20 text-rose-200'
                  : appsStatus === 'loading'
                    ? 'bg-amber-500/20 text-amber-200'
                    : 'bg-slate-800 text-slate-300'
            "
          >
            {{ appsStatus }}
          </span>
          <span class="text-slate-300">{{ appsMessage }}</span>
        </div>

        <div class="mt-4 overflow-x-auto rounded-xl border border-slate-700 bg-slate-950/80">
          <table class="min-w-full text-left text-sm text-slate-300">
            <thead class="border-b border-slate-700 bg-slate-900/70 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th class="px-3 py-2">Name</th>
                <th class="px-3 py-2">ID</th>
                <th class="px-3 py-2">Tab</th>
                <th class="px-3 py-2">Version</th>
                <th class="px-3 py-2">Status</th>
                <th class="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="appItem in apps"
                :key="appItem.id"
                class="border-b border-slate-800 last:border-b-0"
              >
                <td class="px-3 py-2">{{ appItem.name }}</td>
                <td class="px-3 py-2 font-mono text-xs">{{ appItem.id }}</td>
                <td class="px-3 py-2">{{ appItem.tabId }}</td>
                <td class="px-3 py-2">{{ appItem.version }}</td>
                <td class="px-3 py-2">
                  <span
                    class="rounded-md px-2 py-1 text-xs"
                    :class="
                      appItem.running
                        ? 'bg-emerald-500/20 text-emerald-200'
                        : 'bg-slate-800 text-slate-300'
                    "
                  >
                    {{ appItem.running ? `running (${appItem.pid ?? '-'})` : "stopped" }}
                  </span>
                </td>
                <td class="px-3 py-2">
                  <div class="flex gap-1">
                    <button
                      type="button"
                      class="rounded-md border border-slate-600 px-2 py-1 text-xs transition hover:border-cyan-400 hover:text-cyan-200"
                      @click="openNodeAppWindow(appItem.id)"
                    >
                      Open
                    </button>
                    <button
                      v-if="!appItem.running"
                      type="button"
                      class="rounded-md border border-slate-600 px-2 py-1 text-xs transition hover:border-cyan-400 hover:text-cyan-200"
                      @click="startNodeApp(appItem.id)"
                    >
                      Start
                    </button>
                    <button
                      v-else
                      type="button"
                      class="rounded-md border border-rose-500/40 px-2 py-1 text-xs text-rose-200 transition hover:border-rose-400 hover:text-rose-100"
                      @click="stopNodeApp(appItem.id)"
                    >
                      Stop
                    </button>
                    <button
                      type="button"
                      class="rounded-md border border-rose-500/40 px-2 py-1 text-xs text-rose-200 transition hover:border-rose-400 hover:text-rose-100"
                      @click="removeNodeApp(appItem.id)"
                    >
                      Remove
                    </button>
                  </div>
                </td>
              </tr>
              <tr v-if="apps.length === 0">
                <td colspan="6" class="px-3 py-4 text-center text-slate-500">
                  No apps discovered in the user apps directory.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </main>
  </div>
</template>
