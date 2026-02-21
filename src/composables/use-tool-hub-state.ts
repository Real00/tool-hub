import { computed, ref } from "vue";
import { useGeneratorSession } from "./use-generator-session";
import { defaultTabs } from "../config/settings";
import type { AppRunRecord, AppsRootInfo, InstalledApp } from "../types/app";
import type { TabDefinition } from "../types/settings";
import type { UpdateState } from "../types/update";
import {
  batchRemoveApps as batchRemoveAppsBridge,
  batchStopApps as batchStopAppsBridge,
  backupConfiguration,
  checkForUpdates as checkForUpdatesBridge,
  downloadUpdate as downloadUpdateBridge,
  getAppLogs,
  getAppRuns as getAppRunsBridge,
  getAppsRoot,
  getSettingsTabs,
  getUpdateState as getUpdateStateBridge,
  initializeAppsDatabase,
  initializeSettingsDatabase,
  installUpdateAndRestart as installUpdateAndRestartBridge,
  installAppFromDirectory,
  isElectronRuntime,
  listApps,
  openAppWindow,
  pickInstallDirectory,
  pingBackend,
  refreshSystemAppsIndex,
  removeApp,
  restoreConfigurationFromArchive,
  saveSettingsTabs,
  startApp,
  stopApp,
  subscribeAppLogs as subscribeAppLogsBridge,
  subscribeUpdateEvents,
  updateAppTab as updateAppTabBridge,
} from "../platform/electron-bridge";

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

const APP_ALREADY_INSTALLED_PREFIX = "APP_ALREADY_INSTALLED:";
const MAX_RENDERED_LOG_LINES = 400;
const APP_RUN_HISTORY_LIMIT = 40;

function parseAlreadyInstalledAppId(error: unknown): string | null {
  const message = formatError(error).trim();
  const pattern = /APP_ALREADY_INSTALLED:([a-z0-9-]+)/i;
  const match = message.match(pattern);
  if (match) {
    return String(match[1] ?? "").trim() || "";
  }
  if (message.includes("Target app directory already exists")) {
    return "";
  }
  return null;
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

function createDisabledUpdateState(message: string): UpdateState {
  return {
    status: "disabled",
    currentVersion: "-",
    availableVersion: null,
    downloadedVersion: null,
    releaseName: null,
    releaseDate: null,
    releaseNotes: null,
    lastCheckedAt: null,
    downloadedAt: null,
    progress: null,
    message,
  };
}

function createToolHubState() {
  const tabs = ref<TabDefinition[]>(defaultTabs.map((tab) => ({ ...tab })));
  const apps = ref<InstalledApp[]>([]);
  const activeTab = ref(defaultTabs[0]?.id ?? "");
  const showOverview = ref(false);
  const runtimeLabel = ref("Web");

  const bridgeStatus = ref<"idle" | "loading" | "success" | "error">("idle");
  const bridgeMessage = ref("Electron backend not connected yet.");
  const systemAppsStatus = ref<"idle" | "loading" | "success" | "error">("idle");
  const systemAppsMessage = ref("System app index can be refreshed manually.");
  const backupStatus = ref<"idle" | "loading" | "success" | "error">("idle");
  const backupMessage = ref(
    "Backup ZIP includes .tool-hub (apps, generator, apps.sqlite) and settings.sqlite.",
  );
  const restoreStatus = ref<"idle" | "loading" | "success" | "error">("idle");
  const restoreMessage = ref("Restore supports backup ZIP created by Tool Hub.");
  const updateState = ref<UpdateState>(
    createDisabledUpdateState("Automatic updates are only available in Electron runtime."),
  );

  const settingsStatus = ref<"idle" | "saving" | "success" | "error">("idle");
  const settingsMessage = ref("Edit tabs and save to local SQLite.");
  const tabDraft = ref<TabDefinition[]>([]);

  const appsStatus = ref<"idle" | "loading" | "success" | "error">("idle");
  const appsMessage = ref(
    "Node apps are loaded from the fixed user directory.",
  );
  const installSourceDir = ref("");
  const installTabId = ref(defaultTabs[0]?.id ?? "workspace");
  const appsRootInfo = ref<AppsRootInfo | null>(null);

  const logsStatus = ref<"idle" | "loading" | "success" | "error">("idle");
  const appLogs = ref<string[]>([]);
  const logsAppId = ref<string | null>(null);
  const appRuns = ref<AppRunRecord[]>([]);
  const runsStatus = ref<"idle" | "loading" | "success" | "error">("idle");

  let appsPollingTimer: ReturnType<typeof setInterval> | null = null;
  let appsInitialLoadTimer: ReturnType<typeof setTimeout> | null = null;
  let bridgeAndTabsLoadTimer: ReturnType<typeof setTimeout> | null = null;
  let detachUpdateSubscription: (() => void) | null = null;
  let detachAppLogsSubscription: (() => void) | null = null;
  let initialized = false;

  const {
    autoDetectClaudePath,
    claudeCliPath,
    createNewGeneratorProject,
    generatorFileContent,
    generatorFileLoading,
    generatorFilePath,
    generatorFileTruncated,
    generatorMessage,
    generatorProject,
    generatorProjectId,
    generatorProjectName,
    generatorProjects,
    generatorStatus,
    generatorTabId,
    generatorTerminal,
    generatorTerminalMessage,
    generatorTerminalStatus,
    installAppFromGeneratorProject,
    loadGeneratorProjects,
    loadGeneratorSettingsFromStorage,
    loadGeneratorTerminalState,
    openGeneratorProjectFile,
    resizeEmbeddedTerminal,
    saveClaudePathConfig,
    selectGeneratorProject,
    sendEmbeddedTerminalData,
    startEmbeddedTerminal,
    detachGeneratorTerminalSubscription,
    stopEmbeddedTerminal,
    syncGeneratorTabIdWithTabs,
  } = useGeneratorSession({
    tabs,
    onInstalled: ({ apps: installedApps, generatedAppId, tabId }) => {
      applyApps(installedApps);
      appsStatus.value = "success";
      appsMessage.value = `Installed generator app: ${generatedAppId} (tab=${tabId}).`;
    },
  });

  const activeTabLabel = computed(() => {
    return (
      tabs.value.find((tab) => tab.id === activeTab.value)?.label ?? "Unknown"
    );
  });

  const appsInActiveTab = computed(() => {
    return apps.value.filter((app) => app.tabId === activeTab.value);
  });

  const logsAppName = computed(() => {
    if (!logsAppId.value) {
      return "";
    }
    return (
      apps.value.find((item) => item.id === logsAppId.value)?.name ??
      logsAppId.value
    );
  });

  function detachAppLogStreaming() {
    detachAppLogsSubscription?.();
    detachAppLogsSubscription = null;
  }

  function appendAppLogLine(line: string) {
    appLogs.value.push(line);
    if (appLogs.value.length > MAX_RENDERED_LOG_LINES) {
      appLogs.value.splice(0, appLogs.value.length - MAX_RENDERED_LOG_LINES);
    }
  }

  function attachAppLogStreaming(appId: string) {
    detachAppLogStreaming();
    if (!isElectronRuntime()) {
      return;
    }
    detachAppLogsSubscription = subscribeAppLogsBridge(appId, (event) => {
      if (logsAppId.value !== appId) {
        return;
      }
      appendAppLogLine(event.line);
      logsStatus.value = "success";
    });
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
    syncGeneratorTabIdWithTabs();
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
      settingsMessage.value =
        "Browser mode: tabs are editable but not persisted to SQLite.";
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
      detachAppLogStreaming();
      appLogs.value = [];
      logsAppId.value = null;
      logsStatus.value = "idle";
      appRuns.value = [];
      runsStatus.value = "idle";
      return;
    }

    appsStatus.value = "loading";
    try {
      const [rootInfo, list] = await Promise.all([getAppsRoot(), listApps()]);
      appsRootInfo.value = rootInfo;
      applyApps(list);
      if (
        logsAppId.value &&
        !list.some((appItem) => appItem.id === logsAppId.value)
      ) {
        detachAppLogStreaming();
        appLogs.value = [];
        logsAppId.value = null;
        logsStatus.value = "idle";
        appRuns.value = [];
        runsStatus.value = "idle";
      }
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
      bridgeMessage.value =
        "Current runtime is browser-only. Start via `pnpm electron:dev`.";
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

  async function refreshSystemAppsData() {
    if (!isElectronRuntime()) {
      systemAppsStatus.value = "error";
      systemAppsMessage.value =
        "System apps refresh is only available in Electron runtime.";
      return;
    }

    systemAppsStatus.value = "loading";
    systemAppsMessage.value = "Refreshing system app index...";
    try {
      const count = await refreshSystemAppsIndex();
      systemAppsStatus.value = "success";
      systemAppsMessage.value = `System app index refreshed. ${count} item(s) available.`;
    } catch (error) {
      systemAppsStatus.value = "error";
      systemAppsMessage.value = `System app refresh failed: ${formatError(error)}`;
    }
  }

  function applyUpdateState(next: UpdateState) {
    updateState.value = {
      ...next,
      progress: next.progress ? { ...next.progress } : null,
    };
  }

  async function loadUpdateState() {
    if (!isElectronRuntime()) {
      updateState.value = createDisabledUpdateState(
        "Automatic updates are only available in Electron runtime.",
      );
      return;
    }

    try {
      const nextState = await getUpdateStateBridge();
      applyUpdateState(nextState);
    } catch (error) {
      updateState.value = {
        ...updateState.value,
        status: "error",
        message: `Failed to load update state: ${formatError(error)}`,
      };
    }
  }

  async function checkForAppUpdates() {
    if (!isElectronRuntime()) {
      updateState.value = createDisabledUpdateState(
        "Automatic updates are only available in Electron runtime.",
      );
      return;
    }

    try {
      const nextState = await checkForUpdatesBridge();
      applyUpdateState(nextState);
    } catch (error) {
      updateState.value = {
        ...updateState.value,
        status: "error",
        message: `Update check failed: ${formatError(error)}`,
      };
    }
  }

  async function downloadAppUpdate() {
    if (!isElectronRuntime()) {
      updateState.value = createDisabledUpdateState(
        "Automatic updates are only available in Electron runtime.",
      );
      return;
    }

    try {
      const nextState = await downloadUpdateBridge();
      applyUpdateState(nextState);
    } catch (error) {
      updateState.value = {
        ...updateState.value,
        status: "error",
        message: `Update download failed: ${formatError(error)}`,
      };
    }
  }

  async function installAppUpdate() {
    if (!isElectronRuntime()) {
      updateState.value = createDisabledUpdateState(
        "Automatic updates are only available in Electron runtime.",
      );
      return;
    }
    if (updateState.value.status !== "downloaded") {
      updateState.value = {
        ...updateState.value,
        message: "No downloaded update is ready to install.",
      };
      return;
    }
    if (!window.confirm("Install downloaded update now and restart the app?")) {
      return;
    }

    try {
      const willInstall = await installUpdateAndRestartBridge();
      if (!willInstall) {
        updateState.value = {
          ...updateState.value,
          status: "error",
          message: "Install request was rejected by updater state.",
        };
      }
    } catch (error) {
      updateState.value = {
        ...updateState.value,
        status: "error",
        message: `Failed to install update: ${formatError(error)}`,
      };
    }
  }

  async function backupConfigData() {
    if (!isElectronRuntime()) {
      backupStatus.value = "error";
      backupMessage.value = "Backup is only available in Electron runtime.";
      return;
    }

    backupStatus.value = "loading";
    backupMessage.value = "Creating backup...";

    try {
      const result = await backupConfiguration();
      if (result.canceled) {
        backupStatus.value = "idle";
        backupMessage.value = "Backup canceled.";
        return;
      }
      backupStatus.value = "success";
      backupMessage.value = `Backup ZIP created: ${result.archivePath} (${result.includedPaths.length} item(s)).`;
    } catch (error) {
      backupStatus.value = "error";
      backupMessage.value = `Backup failed: ${formatError(error)}`;
    }
  }

  async function restoreConfigData() {
    if (!isElectronRuntime()) {
      restoreStatus.value = "error";
      restoreMessage.value = "Restore is only available in Electron runtime.";
      return;
    }

    if (
      !window.confirm(
        "Restore will overwrite current configuration (.tool-hub and settings DB). Continue?",
      )
    ) {
      restoreStatus.value = "idle";
      restoreMessage.value = "Restore canceled.";
      return;
    }

    restoreStatus.value = "loading";
    restoreMessage.value = "Restoring from backup ZIP...";
    detachAppLogStreaming();
    const shouldResumePolling = !!appsPollingTimer;
    if (appsPollingTimer) {
      clearInterval(appsPollingTimer);
      appsPollingTimer = null;
    }

    try {
      const result = await restoreConfigurationFromArchive();
      if (result.canceled) {
        restoreStatus.value = "idle";
        restoreMessage.value = "Restore canceled.";
        return;
      }
      restoreStatus.value = "success";
      restoreMessage.value = result.restartRecommended
        ? `Restore completed from ${result.archivePath}. Restart app for a clean state.`
        : `Restore completed from ${result.archivePath}.`;
      await loadTabsFromStorage();
      await loadAppsData();
      await loadGeneratorProjects();
    } catch (error) {
      restoreStatus.value = "error";
      restoreMessage.value = `Restore failed: ${formatError(error)}`;
    } finally {
      if (shouldResumePolling) {
        startAppsPolling();
      }
    }
  }

  function enterSettingsMode() {
    tabDraft.value = cloneTabs(tabs.value);
    settingsStatus.value = "idle";
    settingsMessage.value = "Edit tabs and save to local SQLite.";
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

  function moveTabRowTo(fromIndex: number, toIndex: number) {
    if (fromIndex < 0 || fromIndex >= tabDraft.value.length) {
      return;
    }

    const next = [...tabDraft.value];
    const [item] = next.splice(fromIndex, 1);
    if (!item) {
      return;
    }

    const boundedToIndex = Math.max(0, Math.min(next.length, toIndex));
    next.splice(boundedToIndex, 0, item);
    tabDraft.value = next;
  }

  function moveTabRow(index: number, direction: "up" | "down") {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= tabDraft.value.length) {
      return;
    }
    moveTabRowTo(index, targetIndex);
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
      settingsMessage.value =
        "Initialize DB is only available in Electron runtime.";
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
      const list = await installAppFromDirectory(
        installSourceDir.value.trim(),
        installTabId.value,
        false,
      );
      applyApps(list);
      appsStatus.value = "success";
      appsMessage.value = `App installed successfully (tabId=${installTabId.value}).`;
      installSourceDir.value = "";
    } catch (error) {
      const existingAppId = parseAlreadyInstalledAppId(error);
      if (existingAppId !== null) {
        const displayId = existingAppId || "this app";
        const shouldOverwrite = window.confirm(
          `App "${displayId}" is already installed. Overwrite existing installation?`,
        );
        if (!shouldOverwrite) {
          appsStatus.value = "idle";
          appsMessage.value = "Install canceled.";
          return;
        }

        appsStatus.value = "loading";
        appsMessage.value = `Overwriting app "${displayId}"...`;

        try {
          const list = await installAppFromDirectory(
            installSourceDir.value.trim(),
            installTabId.value,
            true,
          );
          applyApps(list);
          appsStatus.value = "success";
          appsMessage.value = `App overwritten successfully (tabId=${installTabId.value}).`;
          installSourceDir.value = "";
          return;
        } catch (overwriteError) {
          appsStatus.value = "error";
          appsMessage.value = `Overwrite failed: ${formatError(overwriteError)}`;
          return;
        }
      }

      appsStatus.value = "error";
      appsMessage.value = `Install failed: ${formatError(error)}`;
    }
  }

  async function chooseInstallDirectory() {
    if (!isElectronRuntime()) {
      appsStatus.value = "error";
      appsMessage.value =
        "Directory picker is only available in Electron runtime.";
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
      appsMessage.value =
        "Initialize DB is only available in Electron runtime.";
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

    if (
      !window.confirm(
        `Remove app "${appId}"? This will delete its folder from apps root.`,
      )
    ) {
      return;
    }

    appsStatus.value = "loading";
    appsMessage.value = `Removing app: ${appId}...`;

    try {
      const list = await removeApp(appId);
      applyApps(list);
      if (logsAppId.value === appId) {
        detachAppLogStreaming();
        logsAppId.value = null;
        appLogs.value = [];
        logsStatus.value = "idle";
        appRuns.value = [];
        runsStatus.value = "idle";
      }
      appsStatus.value = "success";
      appsMessage.value = `App removed: ${appId}`;
    } catch (error) {
      appsStatus.value = "error";
      appsMessage.value = `Remove failed: ${formatError(error)}`;
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
    appsStatus.value = "loading";
    appsMessage.value = `Opening app: ${appId}...`;
    try {
      // Open action now also ensures backend runtime is started.
      const list = await startApp(appId);
      applyApps(list);
      await openAppWindow(appId);
      appsStatus.value = "success";
      appsMessage.value = `App opened: ${appId}`;
      await loadAppLogs(appId);
    } catch (error) {
      appsStatus.value = "error";
      appsMessage.value = `Open failed: ${formatError(error)}`;
    }
  }

  async function updateNodeAppTab(appId: string, tabId: string) {
    if (!isElectronRuntime()) {
      appsStatus.value = "error";
      appsMessage.value = "Tab update is only available in Electron runtime.";
      return;
    }

    const normalizedTabId = normalizeTabId(tabId);
    if (!normalizedTabId) {
      appsStatus.value = "error";
      appsMessage.value = "Please choose a valid tab.";
      return;
    }

    appsStatus.value = "loading";
    appsMessage.value = `Updating tab for app "${appId}"...`;
    try {
      const list = await updateAppTabBridge(appId, normalizedTabId);
      applyApps(list);
      appsStatus.value = "success";
      appsMessage.value = `Updated app tab: ${appId} -> ${normalizedTabId}`;
    } catch (error) {
      appsStatus.value = "error";
      appsMessage.value = `Update tab failed: ${formatError(error)}`;
    }
  }

  async function batchStopNodeApps(appIds: string[]) {
    if (!isElectronRuntime()) {
      appsStatus.value = "error";
      appsMessage.value = "Batch stop is only available in Electron runtime.";
      return;
    }

    const targets = Array.from(
      new Set(appIds.map((item) => item.trim()).filter(Boolean)),
    );
    if (targets.length === 0) {
      return;
    }

    appsStatus.value = "loading";
    appsMessage.value = `Stopping ${targets.length} app(s)...`;
    try {
      const list = await batchStopAppsBridge(targets);
      applyApps(list);
      appsStatus.value = "success";
      appsMessage.value = `Stopped ${targets.length} app(s).`;
      if (logsAppId.value && targets.includes(logsAppId.value)) {
        await loadAppRuns(logsAppId.value);
      }
    } catch (error) {
      appsStatus.value = "error";
      appsMessage.value = `Batch stop failed: ${formatError(error)}`;
    }
  }

  async function batchRemoveNodeApps(appIds: string[]) {
    if (!isElectronRuntime()) {
      appsStatus.value = "error";
      appsMessage.value = "Batch remove is only available in Electron runtime.";
      return;
    }

    const targets = Array.from(
      new Set(appIds.map((item) => item.trim()).filter(Boolean)),
    );
    if (targets.length === 0) {
      return;
    }

    if (
      !window.confirm(
        `Remove ${targets.length} app(s)? This will delete their folders from apps root.`,
      )
    ) {
      return;
    }

    appsStatus.value = "loading";
    appsMessage.value = `Removing ${targets.length} app(s)...`;
    try {
      const list = await batchRemoveAppsBridge(targets);
      applyApps(list);
      if (logsAppId.value && targets.includes(logsAppId.value)) {
        detachAppLogStreaming();
        logsAppId.value = null;
        appLogs.value = [];
        logsStatus.value = "idle";
        appRuns.value = [];
        runsStatus.value = "idle";
      }
      appsStatus.value = "success";
      appsMessage.value = `Removed ${targets.length} app(s).`;
    } catch (error) {
      appsStatus.value = "error";
      appsMessage.value = `Batch remove failed: ${formatError(error)}`;
    }
  }

  async function loadAppRuns(appId?: string | null) {
    const targetAppId = appId ?? logsAppId.value;
    if (!targetAppId || !isElectronRuntime()) {
      appRuns.value = [];
      runsStatus.value = "idle";
      return;
    }

    runsStatus.value = "loading";
    try {
      appRuns.value = await getAppRunsBridge(targetAppId, APP_RUN_HISTORY_LIMIT);
      runsStatus.value = "success";
    } catch (error) {
      runsStatus.value = "error";
      appRuns.value = [];
      if (logsStatus.value === "success") {
        appsMessage.value = `Run history load failed: ${formatError(error)}`;
      }
    }
  }

  async function loadAppLogs(appId?: string | null) {
    const targetAppId = appId ?? logsAppId.value;
    if (!targetAppId || !isElectronRuntime()) {
      detachAppLogStreaming();
      appLogs.value = [];
      logsAppId.value = null;
      logsStatus.value = "idle";
      appRuns.value = [];
      runsStatus.value = "idle";
      return;
    }

    detachAppLogStreaming();
    logsAppId.value = targetAppId;
    logsStatus.value = "loading";
    try {
      appLogs.value = await getAppLogs(targetAppId);
      logsStatus.value = "success";
      attachAppLogStreaming(targetAppId);
    } catch (error) {
      logsStatus.value = "error";
      appLogs.value = [`Log load failed: ${formatError(error)}`];
    }
    await loadAppRuns(targetAppId);
  }

  function toggleOverview() {
    showOverview.value = !showOverview.value;
  }

  function startAppsPolling() {
    if (appsPollingTimer) {
      clearInterval(appsPollingTimer);
    }
    appsPollingTimer = setInterval(() => {
      void loadAppsData();
    }, 4000);
  }

  function init() {
    if (initialized) {
      return;
    }
    initialized = true;
    runtimeLabel.value = isElectronRuntime() ? "Electron" : "Web";

    if (isElectronRuntime()) {
      detachUpdateSubscription?.();
      detachUpdateSubscription = subscribeUpdateEvents((nextState) => {
        applyUpdateState(nextState);
      });
      void loadUpdateState();
    } else {
      updateState.value = createDisabledUpdateState(
        "Automatic updates are only available in Electron runtime.",
      );
    }

    bridgeAndTabsLoadTimer = setTimeout(() => {
      void loadTabsFromStorage();
      void testElectronBridge();
      void loadGeneratorSettingsFromStorage();
      void loadGeneratorProjects();
    }, 120);

    appsInitialLoadTimer = setTimeout(() => {
      void loadAppsData();
      startAppsPolling();
    }, 1200);
  }

  function dispose() {
    initialized = false;

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
    detachUpdateSubscription?.();
    detachUpdateSubscription = null;
    detachAppLogStreaming();
    detachGeneratorTerminalSubscription();
  }

  return {
    activeTab,
    activeTabLabel,
    addTabRow,
    appLogs,
    appRuns,
    apps,
    appsInActiveTab,
    appsMessage,
    appsRootInfo,
    appsStatus,
    autoDetectClaudePath,
    autofillTabId,
    backupConfigData,
    backupMessage,
    backupStatus,
    bridgeMessage,
    bridgeStatus,
    batchRemoveNodeApps,
    batchStopNodeApps,
    checkForAppUpdates,
    systemAppsMessage,
    systemAppsStatus,
    chooseInstallDirectory,
    claudeCliPath,
    createNewGeneratorProject,
    dispose,
    enterSettingsMode,
    generatorFileContent,
    generatorFileLoading,
    generatorFilePath,
    generatorFileTruncated,
    generatorMessage,
    generatorProject,
    generatorProjectId,
    generatorProjectName,
    generatorProjects,
    generatorStatus,
    generatorTabId,
    generatorTerminal,
    generatorTerminalMessage,
    generatorTerminalStatus,
    init,
    initializeAppsDb,
    initializeSettingsDb,
    installAppFromGeneratorProject,
    installAppUpdate,
    installNodeApp,
    installSourceDir,
    installTabId,
    loadAppLogs,
    loadAppRuns,
    loadAppsData,
    loadGeneratorProjects,
    loadGeneratorSettingsFromStorage,
    loadGeneratorTerminalState,
    loadTabsFromStorage,
    logsAppId,
    logsAppName,
    logsStatus,
    openGeneratorProjectFile,
    openNodeAppWindow,
    moveTabRow,
    moveTabRowTo,
    removeNodeApp,
    removeTabRow,
    restoreConfigData,
    restoreMessage,
    restoreStatus,
    runsStatus,
    runtimeLabel,
    loadUpdateState,
    refreshSystemAppsData,
    resizeEmbeddedTerminal,
    saveClaudePathConfig,
    saveTabsToStorage,
    selectGeneratorProject,
    sendEmbeddedTerminalData,
    settingsMessage,
    settingsStatus,
    showOverview,
    startEmbeddedTerminal,
    detachGeneratorTerminalSubscription,
    stopEmbeddedTerminal,
    stopNodeApp,
    downloadAppUpdate,
    tabDraft,
    tabs,
    testElectronBridge,
    toggleOverview,
    updateState,
    updateNodeAppTab,
  };
}

export type ToolHubState = ReturnType<typeof createToolHubState>;

let singletonState: ToolHubState | null = null;

export function useToolHubState(): ToolHubState {
  if (!singletonState) {
    singletonState = createToolHubState();
  }
  return singletonState;
}
