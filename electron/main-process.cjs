const {
  app,
  BrowserWindow,
  clipboard,
  Menu,
  Notification,
  Tray,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  session,
  shell,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const { createAutoUpdateController } = require("./main-process/auto-update.cjs");
const { createAiChatManager } = require("./ai-chat-manager.cjs");
const { createWindowManager } = require("./main-process/window-manager.cjs");
const { createAppRuntimeWindowsController } = require("./main-process/app-runtime-windows.cjs");
const { createContextDispatchController } = require("./main-process/context-dispatch.cjs");
const { createConfigRestoreController } = require("./main-process/config-restore.cjs");
const { createSystemRecorderManager } = require("./system-recorder-manager.cjs");

// Lazily loaded heavy modules; restore flow temporarily gates access.
let appsManagerModule = null;
let settingsStoreModule = null;
let appGeneratorModule = null;
let systemAppsManagerModule = null;
let windowsContextMenuModule = null;

function loadAppsManagerModule() {
  if (!appsManagerModule) {
    appsManagerModule = require("./apps-manager.cjs");
  }
  return appsManagerModule;
}

function loadSettingsStoreModule() {
  if (!settingsStoreModule) {
    settingsStoreModule = require("./settings-store.cjs");
  }
  return settingsStoreModule;
}

function loadAppGeneratorModule() {
  if (!appGeneratorModule) {
    appGeneratorModule = require("./app-generator.cjs");
  }
  return appGeneratorModule;
}

function getSystemAppsManager() {
  if (!systemAppsManagerModule) {
    systemAppsManagerModule = require("./system-apps-manager.cjs");
  }
  return systemAppsManagerModule;
}

function getWindowsContextMenu() {
  if (!windowsContextMenuModule) {
    windowsContextMenuModule = require("./windows-context-menu.cjs");
  }
  return windowsContextMenuModule;
}

const devServerUrl =
  process.argv.find((value) => /^https?:\/\//i.test(String(value ?? ""))) || "";
const isDev = Boolean(devServerUrl);
const APP_NAME = "Tool Hub";
const hasSingleInstanceLock = app.requestSingleInstanceLock();
const bootTraceEnabled = process.env.TOOL_HUB_BOOT_LOG === "1";
const bootStartAt = Date.now();
const APP_RUNTIME_LAUNCH_CONTEXT_CHANNEL = "app-runtime:launch-context";
const APP_LOG_EVENT_CHANNEL = "apps:log-event";
const AUTO_UPDATE_EVENT_CHANNEL = "update:state";
const AUTO_UPDATE_STARTUP_DELAY_MS = 15000;
const CONTEXT_DISPATCH_REQUEST_CHANNEL = "context-dispatch:request";
const CONTEXT_DISPATCH_SOURCE_EXPLORER = "explorer-context-menu";
const CONTEXT_DISPATCH_AGGREGATE_WINDOW_MS = 650;
const CONTEXT_DISPATCH_MAX_QUEUE = 32;
const CONTEXT_DISPATCH_PENDING_TTL_MS = 5000;
const DEFAULT_QUICK_LAUNCHER_HOTKEY = "Alt+Space";

function bootTrace(message) {
  if (!bootTraceEnabled) {
    return;
  }
  const elapsed = Date.now() - bootStartAt;
  console.log(`[boot +${elapsed}ms] ${message}`);
}

let closeQuickLauncherWindowForRestore = () => {};
let closeAllAppWindowsForRestore = () => {};
let getMainWindowForRestoreDialogs = () => null;

// Restore controller is created first because it provides the access guard
// used by getAppsManager/getSettingsStore/getAppGenerator.
const configRestoreController = createConfigRestoreController({
  app,
  dialog,
  fs,
  path,
  spawn,
  getMainWindow: () => getMainWindowForRestoreDialogs(),
  getAppsManager: () => loadAppsManagerModule(),
  getSettingsStore: () => loadSettingsStoreModule(),
  closeQuickLauncherWindow: () => closeQuickLauncherWindowForRestore(),
  closeAllAppWindows: () => closeAllAppWindowsForRestore(),
});

function getAppsManager(options = {}) {
  configRestoreController.assertRestoreAccessAllowed(options);
  return loadAppsManagerModule();
}

function getSettingsStore(options = {}) {
  configRestoreController.assertRestoreAccessAllowed(options);
  return loadSettingsStoreModule();
}

function getAppGenerator(options = {}) {
  configRestoreController.assertRestoreAccessAllowed(options);
  return loadAppGeneratorModule();
}

const windowManager = createWindowManager({
  app,
  BrowserWindow,
  Menu,
  Tray,
  dialog,
  nativeImage,
  screen,
  shell,
  fs,
  path,
  pathToFileURL,
  electronRootDir: __dirname,
  appName: APP_NAME,
  isDev,
  devServerUrl,
  bootTrace,
  onRequestQuit: () => {
    app.quit();
  },
});

const appRuntimeController = createAppRuntimeWindowsController({
  BrowserWindow,
  Notification,
  dialog,
  fs,
  path,
  electronRootDir: __dirname,
  getAppsManager,
  getMainWindow: () => windowManager.getMainWindow(),
  getAppIcon: () => windowManager.getAppIcon(),
  stripWindowMenu: (win) => windowManager.stripWindowMenu(win),
  attachWindowKeyboardShortcuts: (win) =>
    windowManager.attachWindowKeyboardShortcuts(win),
  appName: APP_NAME,
  launchContextChannel: APP_RUNTIME_LAUNCH_CONTEXT_CHANNEL,
});

const contextDispatchController = createContextDispatchController({
  fs,
  path,
  appName: APP_NAME,
  requestChannel: CONTEXT_DISPATCH_REQUEST_CHANNEL,
  sourceExplorer: CONTEXT_DISPATCH_SOURCE_EXPLORER,
  aggregateWindowMs: CONTEXT_DISPATCH_AGGREGATE_WINDOW_MS,
  maxQueue: CONTEXT_DISPATCH_MAX_QUEUE,
  pendingTtlMs: CONTEXT_DISPATCH_PENDING_TTL_MS,
  collectContextTargetsFromArgv: (argv) =>
    getWindowsContextMenu().collectContextTargetsFromArgv(argv),
  getAppsManager,
  openAppWindowById: (appId, launchContext) =>
    appRuntimeController.openAppWindowById(appId, launchContext),
  showSystemNotification: (title, body, options) =>
    appRuntimeController.showSystemNotification(title, body, options),
});

const autoUpdateController = createAutoUpdateController({
  app,
  isDev,
  eventChannel: AUTO_UPDATE_EVENT_CHANNEL,
  startupDelayMs: AUTO_UPDATE_STARTUP_DELAY_MS,
  onBeforeInstall: () => {
    windowManager.markQuitting();
  },
});

const systemRecorderManager = createSystemRecorderManager({
  app,
  appName: APP_NAME,
  desktopCapturer,
  dialog,
  screen,
  getMainWindow: () => windowManager.getMainWindow(),
  getSettingsStore,
});

const aiChatManager = createAiChatManager({
  getSettingsStore,
});

windowManager.setSystemRecorderLifecycle({
  onWindowUnavailable: (reason) => {
    void systemRecorderManager.abortActiveRecorder(reason);
  },
});

// Cross-module wiring via callbacks keeps modules acyclic.
contextDispatchController.setRendererProvider(() => {
  const mainWindow = windowManager.getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }
  return mainWindow.webContents;
});

windowManager.setContextDispatchFlusher(() => {
  contextDispatchController.flushPendingToRenderer();
});

closeQuickLauncherWindowForRestore = () => {
  windowManager.closeQuickLauncherWindow();
};
closeAllAppWindowsForRestore = () => {
  appRuntimeController.closeAllAppWindows();
};
getMainWindowForRestoreDialogs = () => windowManager.getMainWindow();

const terminalSubscriptions = new Map();
const appLogSubscriptions = new Map();

function ensureWindowsContextMenuRegistered() {
  if (process.platform !== "win32" || isDev) {
    return;
  }
  try {
    getWindowsContextMenu().registerWindowsContextMenu();
  } catch (error) {
    console.warn(
      "Windows context menu registration skipped:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function normalizeQuickLauncherHotkey(input) {
  return String(input ?? "").trim();
}

function stripWrappingQuotes(input) {
  const value = String(input ?? "").trim();
  if (value.startsWith("\"") && value.endsWith("\"") && value.length >= 2) {
    return value.slice(1, -1).trim();
  }
  return value;
}

function resolveLocalPathContext(input) {
  const rawText = String(input ?? "").trim();
  if (!rawText || /[\r\n]/.test(rawText)) {
    return null;
  }

  const candidate = stripWrappingQuotes(rawText);
  if (!candidate || !path.isAbsolute(candidate)) {
    return null;
  }

  const normalizedPath = path.normalize(candidate);
  if (!fs.existsSync(normalizedPath)) {
    return null;
  }

  const stat = fs.statSync(normalizedPath);
  return {
    rawText,
    path: normalizedPath,
    kind: stat.isDirectory() ? "directory" : "file",
  };
}

function getQuickLauncherClipboardPathContext() {
  return resolveLocalPathContext(clipboard.readText());
}

function requireExistingLocalPathContext(input) {
  const context = resolveLocalPathContext(input);
  if (!context) {
    throw new Error("Path not found or not a supported absolute local path.");
  }
  return context;
}

async function openClipboardPathFile(input) {
  const context = requireExistingLocalPathContext(input);
  const errorMessage = await shell.openPath(context.path);
  if (errorMessage) {
    throw new Error(errorMessage);
  }
  return true;
}

async function openClipboardPathLocation(input) {
  const context = requireExistingLocalPathContext(input);
  if (context.kind === "file") {
    shell.showItemInFolder(context.path);
    return true;
  }

  const errorMessage = await shell.openPath(context.path);
  if (errorMessage) {
    throw new Error(errorMessage);
  }
  return true;
}

async function loadQuickLauncherHotkeyFromSettings() {
  try {
    const stored = await getSettingsStore().getQuickLauncherHotkey();
    const normalized = normalizeQuickLauncherHotkey(stored);
    return normalized || DEFAULT_QUICK_LAUNCHER_HOTKEY;
  } catch (error) {
    console.warn(
      "Quick launcher hotkey load failed:",
      error instanceof Error ? error.message : String(error),
    );
    return DEFAULT_QUICK_LAUNCHER_HOTKEY;
  }
}

function makeTerminalSubscriptionKey(webContentsId, projectId) {
  return `${webContentsId}:${projectId}`;
}

function removeTerminalSubscription(webContentsId, projectId) {
  const key = makeTerminalSubscriptionKey(webContentsId, projectId);
  const unsubscribe = terminalSubscriptions.get(key);
  if (!unsubscribe) {
    return;
  }
  terminalSubscriptions.delete(key);
  try {
    unsubscribe();
  } catch {
    // Ignore cleanup errors.
  }
}

function removeAllTerminalSubscriptionsForWebContents(webContentsId) {
  const prefix = `${webContentsId}:`;
  Array.from(terminalSubscriptions.keys())
    .filter((key) => key.startsWith(prefix))
    .forEach((key) => {
      const unsubscribe = terminalSubscriptions.get(key);
      terminalSubscriptions.delete(key);
      try {
        unsubscribe?.();
      } catch {
        // Ignore cleanup errors.
      }
    });
}

function makeAppLogSubscriptionKey(webContentsId, appId) {
  return `${webContentsId}:${appId}`;
}

function removeAppLogSubscription(webContentsId, appId) {
  const key = makeAppLogSubscriptionKey(webContentsId, appId);
  const unsubscribe = appLogSubscriptions.get(key);
  if (!unsubscribe) {
    return;
  }
  appLogSubscriptions.delete(key);
  try {
    unsubscribe();
  } catch {
    // Ignore cleanup errors.
  }
}

function removeAllAppLogSubscriptionsForWebContents(webContentsId) {
  const prefix = `${webContentsId}:`;
  Array.from(appLogSubscriptions.keys())
    .filter((key) => key.startsWith(prefix))
    .forEach((key) => {
      const unsubscribe = appLogSubscriptions.get(key);
      appLogSubscriptions.delete(key);
      try {
        unsubscribe?.();
      } catch {
        // Ignore cleanup errors.
      }
    });
}

// Core IPC registrations.
ipcMain.handle("context-dispatch:consume-pending", async () => {
  return contextDispatchController.consumePending();
});

ipcMain.handle("tool-hub:ping", (_event, name) => {
  const dbPath = getSettingsStore().resolveDatabasePath();
  return `Electron backend is online: ${name} (sqlite: ${dbPath})`;
});

ipcMain.handle("settings:get-tabs", async () => {
  return getSettingsStore().getSettingsTabs();
});

ipcMain.handle("settings:save-tabs", async (_event, tabs) => {
  return getSettingsStore().saveSettingsTabs(tabs);
});

ipcMain.handle("settings:initialize-db", async () => {
  return getSettingsStore().initializeSettingsStore();
});

ipcMain.handle("settings:backup-config", async () => {
  return configRestoreController.backupConfigurationData();
});

ipcMain.handle("settings:restore-config", async () => {
  return configRestoreController.restoreConfigurationFromArchive();
});

ipcMain.handle("generator:get-settings", async () => {
  return getAppGenerator().getGeneratorSettings(getSettingsStore());
});

ipcMain.handle("generator:save-settings", async (_event, input) => {
  return getAppGenerator().saveGeneratorSettings(getSettingsStore(), input);
});

ipcMain.handle("generator:detect-claude-cli", async () => {
  return getAppGenerator().detectClaudeCli(getSettingsStore());
});

ipcMain.handle("generator:create-project", async (_event, projectName) => {
  return getAppGenerator().createProject(projectName);
});

ipcMain.handle("generator:get-project", async (_event, projectId) => {
  return getAppGenerator().getProject(projectId);
});

ipcMain.handle("generator:list-projects", async () => {
  return getAppGenerator().listProjects();
});

ipcMain.handle(
  "generator:read-project-file",
  async (_event, projectId, filePath) => {
    return getAppGenerator().readProjectFile(projectId, filePath);
  },
);

ipcMain.handle("generator:update-project-agents", async (_event, projectId) => {
  return getAppGenerator().updateProjectAgentsRules(projectId);
});

ipcMain.handle(
  "generator:install-project",
  async (_event, projectId, tabId, overwriteExisting, verifyCommandOverride) => {
    return getAppGenerator().installProjectApp(
      getAppsManager(),
      getSettingsStore(),
      projectId,
      tabId,
      overwriteExisting,
      verifyCommandOverride,
    );
  },
);

ipcMain.handle("generator:validate-project", async (_event, projectId, tabId) => {
  return getAppGenerator().validateProject(projectId, tabId);
});

ipcMain.handle("generator:run-verify", async (_event, projectId, commandOverride) => {
  return getAppGenerator().runProjectVerify(
    projectId,
    getSettingsStore(),
    commandOverride,
  );
});

ipcMain.handle("generator:get-terminal", async (_event, projectId) => {
  return getAppGenerator().getProjectTerminal(projectId);
});

ipcMain.handle("generator:start-terminal", async (_event, projectId) => {
  return getAppGenerator().startProjectTerminal(projectId);
});

ipcMain.handle(
  "generator:terminal-input",
  async (_event, projectId, text, appendNewline) => {
    return getAppGenerator().sendProjectTerminalInput(
      projectId,
      text,
      appendNewline,
    );
  },
);

ipcMain.handle("generator:stop-terminal", async (_event, projectId) => {
  return getAppGenerator().stopProjectTerminal(projectId);
});

ipcMain.handle(
  "generator:resize-terminal",
  async (_event, projectId, cols, rows) => {
    return getAppGenerator().resizeProjectTerminal(projectId, cols, rows);
  },
);

ipcMain.on("generator:terminal-subscribe", (event, projectId) => {
  const webContents = event.sender;
  const webContentsId = webContents.id;
  const key = makeTerminalSubscriptionKey(webContentsId, projectId);
  removeTerminalSubscription(webContentsId, projectId);

  const unsubscribe = getAppGenerator().subscribeProjectTerminal(
    projectId,
    (payload) => {
      if (webContents.isDestroyed()) {
        removeTerminalSubscription(webContentsId, projectId);
        return;
      }
      webContents.send("generator:terminal-output", payload);
    },
  );
  terminalSubscriptions.set(key, unsubscribe);

  webContents.once("destroyed", () => {
    removeAllTerminalSubscriptionsForWebContents(webContentsId);
  });
});

ipcMain.on("generator:terminal-unsubscribe", (event, projectId) => {
  removeTerminalSubscription(event.sender.id, projectId);
});

ipcMain.handle("apps:get-root", () => {
  const appsManager = getAppsManager();
  return {
    appsRoot: appsManager.resolveAppsRoot(),
    dbPath: appsManager.resolveAppsDbPath(),
  };
});

ipcMain.handle("apps:list", async () => {
  return getAppsManager().listApps();
});

ipcMain.handle("apps:initialize-db", async () => {
  return getAppsManager().initializeAppsDatabase();
});

ipcMain.handle(
  "apps:install-from-directory",
  async (_event, sourceDir, tabId, overwriteExisting) => {
    return getAppsManager().installAppFromDirectory(
      sourceDir,
      tabId,
      overwriteExisting,
    );
  },
);

ipcMain.handle("apps:start", async (_event, appId) => {
  return getAppsManager().startApp(appId);
});

ipcMain.handle("apps:stop", async (_event, appId) => {
  appRuntimeController.closeAppWindowById(appId);
  return getAppsManager().stopApp(appId);
});

ipcMain.handle("apps:batch-stop", async (_event, appIds) => {
  if (Array.isArray(appIds)) {
    appIds.forEach((appId) => appRuntimeController.closeAppWindowById(appId));
  }
  return getAppsManager().stopApps(appIds);
});

ipcMain.handle("apps:get-logs", (_event, appId) => {
  return getAppsManager().getAppLogs(appId);
});

ipcMain.handle("apps:get-runs", (_event, appId, limit) => {
  return getAppsManager().getAppRuns(appId, limit);
});

ipcMain.handle("apps:update-tab", async (_event, appId, tabId) => {
  return getAppsManager().updateAppTab(appId, tabId);
});

ipcMain.handle("apps:set-auto-start", async (_event, appId, enabled) => {
  return getAppsManager().setAppAutoStart(appId, enabled);
});

ipcMain.handle("apps:kv-list", async (_event, appId) => {
  return getAppsManager().listAppStorage(appId);
});

ipcMain.handle("apps:kv-delete", async (_event, appId, key) => {
  return getAppsManager().deleteAppStorageKey(appId, key);
});

ipcMain.handle("apps:kv-clear", async (_event, appId) => {
  return getAppsManager().clearAppStorage(appId);
});

ipcMain.handle("apps:remove", async (_event, appId, options) => {
  appRuntimeController.closeAppWindowById(appId);
  return getAppsManager().removeApp(appId, options);
});

ipcMain.handle("apps:batch-remove", async (_event, appIds, options) => {
  if (Array.isArray(appIds)) {
    appIds.forEach((appId) => appRuntimeController.closeAppWindowById(appId));
  }
  return getAppsManager().removeApps(appIds, options);
});

ipcMain.handle("apps:open-window", async (_event, appId, launchContext) => {
  return appRuntimeController.openAppWindowById(appId, launchContext);
});

ipcMain.handle("apps:dispatch-capability", async (_event, payload) => {
  try {
    return await contextDispatchController.dispatchCapabilitySelection(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appRuntimeController.showSystemNotification(
      APP_NAME,
      `Capability dispatch failed: ${message}`,
    );
    throw error;
  }
});

ipcMain.on("apps:logs-subscribe", (event, appId) => {
  const webContents = event.sender;
  const webContentsId = webContents.id;
  const key = makeAppLogSubscriptionKey(webContentsId, appId);
  removeAppLogSubscription(webContentsId, appId);

  const unsubscribe = getAppsManager().subscribeAppLogs(appId, (payload) => {
    if (webContents.isDestroyed()) {
      removeAppLogSubscription(webContentsId, appId);
      return;
    }
    webContents.send(APP_LOG_EVENT_CHANNEL, payload);
  });
  appLogSubscriptions.set(key, unsubscribe);

  webContents.once("destroyed", () => {
    removeAllAppLogSubscriptionsForWebContents(webContentsId);
  });
});

ipcMain.on("apps:logs-unsubscribe", (event, appId) => {
  removeAppLogSubscription(event.sender.id, appId);
});

ipcMain.handle("app-runtime:get-info", async (event) => {
  return appRuntimeController.getRuntimeInfo(event);
});

ipcMain.handle("app-runtime:notify", async (event, titleInput, bodyInput, options) => {
  return appRuntimeController.notify(event, titleInput, bodyInput, options);
});

ipcMain.handle("app-runtime:pick-directory", async (event, optionsInput) => {
  return appRuntimeController.pickDirectoryForEvent(event, optionsInput);
});

ipcMain.handle("app-runtime:kv-get", async (event, key) => {
  const appId = appRuntimeController.requireRuntimeAppId(event);
  return getAppsManager().getAppStorageValue(appId, key);
});

ipcMain.handle("app-runtime:kv-set", async (event, key, value) => {
  const appId = appRuntimeController.requireRuntimeAppId(event);
  return getAppsManager().setAppStorageValue(appId, key, value);
});

ipcMain.handle("app-runtime:kv-delete", async (event, key) => {
  const appId = appRuntimeController.requireRuntimeAppId(event);
  return getAppsManager().deleteAppStorageKey(appId, key);
});

ipcMain.handle("app-runtime:kv-list", async (event, prefix) => {
  const appId = appRuntimeController.requireRuntimeAppId(event);
  return getAppsManager().listAppStorage(appId, prefix);
});

ipcMain.handle("app-runtime:kv-clear", async (event) => {
  const appId = appRuntimeController.requireRuntimeAppId(event);
  return getAppsManager().clearAppStorage(appId);
});

ipcMain.handle("app-runtime:file-read", async (event, filePath, options) => {
  const appId = appRuntimeController.requireRuntimeAppId(event);
  return getAppsManager().readAppFile(appId, filePath, options);
});

ipcMain.handle(
  "app-runtime:file-write",
  async (event, filePath, content, options) => {
    const appId = appRuntimeController.requireRuntimeAppId(event);
    return getAppsManager().writeAppFile(appId, filePath, content, options);
  },
);

ipcMain.handle(
  "app-runtime:system-file-read",
  async (event, filePath, options) => {
    const appId = appRuntimeController.requireRuntimeAppId(event);
    return getAppsManager().readSystemFile(appId, filePath, options);
  },
);

ipcMain.handle(
  "app-runtime:system-file-write",
  async (event, filePath, content, options) => {
    const appId = appRuntimeController.requireRuntimeAppId(event);
    return getAppsManager().writeSystemFile(appId, filePath, content, options);
  },
);

ipcMain.handle("apps:pick-install-directory", async () => {
  const result = await dialog.showOpenDialog(windowManager.getMainWindow() ?? undefined, {
    title: "Select app source directory",
    properties: ["openDirectory", "dontAddToRecent"],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle("system-apps:refresh", async () => {
  return getSystemAppsManager().refreshSystemAppsIndex();
});

ipcMain.handle("system-apps:search", async (_event, query, limit) => {
  return getSystemAppsManager().searchSystemApps(query, limit);
});

ipcMain.handle("system-apps:get-by-ids", async (_event, appIds) => {
  return getSystemAppsManager().getSystemAppsByIds(appIds);
});

ipcMain.handle("system-apps:open", async (_event, appId, launchPayload) => {
  if (systemRecorderManager.isRecorderSystemAppId(appId)) {
    windowManager.showSystemRecorderWindow(appId);
    return true;
  }
  if (appId === "builtin:ai-chat") {
    windowManager.showAiChatWindow(launchPayload, launchPayload ? "quick-launcher" : "manual");
    return true;
  }
  return getSystemAppsManager().openSystemApp(appId, launchPayload);
});

ipcMain.handle("system-recorder:get-state", async () => {
  return systemRecorderManager.getRecorderState();
});

ipcMain.handle("system-recorder:list-sources", async (_event, mode) => {
  return systemRecorderManager.listRecorderSources(mode);
});

ipcMain.handle("system-recorder:prepare-preview", async (_event, input) => {
  return systemRecorderManager.preparePreviewCapture(input);
});

ipcMain.handle("system-recorder:start", async (_event, input) => {
  return systemRecorderManager.startRecorder(input);
});

ipcMain.handle("system-recorder:append-chunk", async (_event, sessionId, chunk) => {
  return systemRecorderManager.appendRecordingChunk(sessionId, chunk);
});

ipcMain.handle("system-recorder:finish", async (_event, sessionId) => {
  return systemRecorderManager.finishRecorder(sessionId);
});

ipcMain.handle("system-recorder:abort", async (_event, sessionId, errorMessage) => {
  return systemRecorderManager.abortRecorder(sessionId, errorMessage);
});

ipcMain.handle("system-recorder:pick-ffmpeg-path", async () => {
  return systemRecorderManager.pickAndSaveFfmpegPath();
});

ipcMain.handle("system-recorder:set-ffmpeg-path", async (_event, filePath) => {
  return systemRecorderManager.setFfmpegPath(filePath);
});

ipcMain.handle("quick-launcher:close", async () => {
  windowManager.closeQuickLauncherWindow();
  return true;
});

ipcMain.handle("quick-launcher:get-hotkey-state", async () => {
  return windowManager.getQuickLauncherHotkeyState();
});

ipcMain.handle("quick-launcher:save-hotkey", async (_event, accelerator) => {
  const normalized = normalizeQuickLauncherHotkey(accelerator);
  if (!normalized) {
    throw new Error("Quick launcher hotkey cannot be empty.");
  }
  const saved = await getSettingsStore().saveQuickLauncherHotkey(normalized);
  return windowManager.setQuickLauncherHotkey(saved);
});

ipcMain.handle("quick-launcher:apply-hotkey", async (_event, accelerator) => {
  if (typeof accelerator === "string") {
    const normalized = normalizeQuickLauncherHotkey(accelerator);
    if (!normalized) {
      throw new Error("Quick launcher hotkey cannot be empty.");
    }
    return windowManager.applyQuickLauncherHotkey(normalized);
  }
  return windowManager.applyQuickLauncherHotkey();
});

ipcMain.handle("quick-launcher:retry-hotkey", async () => {
  return windowManager.retryQuickLauncherHotkey();
});

ipcMain.handle("quick-launcher:get-clipboard-path-context", async () => {
  return getQuickLauncherClipboardPathContext();
});

ipcMain.handle("quick-launcher:open-clipboard-path-file", async (_event, targetPath) => {
  return openClipboardPathFile(targetPath);
});

ipcMain.handle("quick-launcher:open-clipboard-path-location", async (_event, targetPath) => {
  return openClipboardPathLocation(targetPath);
});

ipcMain.handle("quick-launcher:set-size", async (_event, mode) => {
  windowManager.setQuickLauncherWindowSize(mode);
  return true;
});

ipcMain.handle("ai-chat:get-settings", async () => {
  return getSettingsStore().getAiChatSettings();
});

ipcMain.handle("ai-chat:save-settings", async (_event, input) => {
  return getSettingsStore().saveAiChatSettings(input);
});

ipcMain.handle("ai-chat:list-models", async (_event, input) => {
  return aiChatManager.listModels(input);
});

ipcMain.handle("ai-chat:list-sessions", async () => {
  return getSettingsStore().listAiChatSessions();
});

ipcMain.handle("ai-chat:create-session", async () => {
  return getSettingsStore().createAiChatSession();
});

ipcMain.handle("ai-chat:delete-session", async (_event, sessionId) => {
  return getSettingsStore().deleteAiChatSession(sessionId);
});

ipcMain.handle("ai-chat:get-session-messages", async (_event, sessionId) => {
  return getSettingsStore().listAiChatSessionMessages(sessionId);
});

ipcMain.handle("ai-chat:send-message", async (_event, input) => {
  return aiChatManager.sendMessage(input);
});

ipcMain.handle("ai-chat:begin-stream", async (_event, requestId) => {
  return aiChatManager.beginStream(requestId);
});

ipcMain.handle("ai-chat:cancel-stream", async (_event, requestId) => {
  return aiChatManager.cancelStream(requestId);
});

ipcMain.handle("ai-chat:get-launch-state", async () => {
  return windowManager.getAiChatLaunchState();
});

ipcMain.on("ai-chat:stream-subscribe", (event) => {
  aiChatManager.subscribe(event.sender);
});

ipcMain.on("ai-chat:stream-unsubscribe", (event) => {
  aiChatManager.unsubscribe(event.sender);
});

ipcMain.handle("update:get-state", async () => {
  return autoUpdateController.getState();
});

ipcMain.handle("update:check", async () => {
  return autoUpdateController.checkForUpdates("manual");
});

ipcMain.handle("update:download", async () => {
  return autoUpdateController.downloadUpdate();
});

ipcMain.handle("update:install", async () => {
  return autoUpdateController.installAndRestart();
});

ipcMain.on("update:subscribe", (event) => {
  autoUpdateController.subscribe(event.sender);
});

ipcMain.on("update:unsubscribe", (event) => {
  autoUpdateController.unsubscribe(event.sender);
});

// App lifecycle orchestration.
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const queuedCount = contextDispatchController.queueTargetsFromArgv(argv);
    if (!app.isReady()) {
      app.once("ready", () => {
        windowManager.showMainWindow();
        windowManager.updateTrayMenu();
      });
      return;
    }
    windowManager.showMainWindow();
    if (queuedCount > 0) {
      contextDispatchController.flushPendingToRenderer();
    }
    windowManager.updateTrayMenu();
  });

  app.whenReady().then(async () => {
    bootTrace("app.whenReady");
    Menu.setApplicationMenu(null);
    session.fromPartition(windowManager.getSystemRecorderPartition()).setDisplayMediaRequestHandler(
      (request, callback) => {
        systemRecorderManager.handleDisplayMediaRequest(request, callback);
      },
      { useSystemPicker: false },
    );
    ensureWindowsContextMenuRegistered();
    await getSettingsStore().reconcileAiChatStreamingMessages().catch((error) => {
      console.warn(
        "AI chat streaming state reconciliation failed:",
        error instanceof Error ? error.message : String(error),
      );
    });
    windowManager.createMainWindow();
    windowManager.createTray();
    const configuredQuickLauncherHotkey = await loadQuickLauncherHotkeyFromSettings();
    windowManager.registerQuickLauncherHotkey(
      globalShortcut,
      configuredQuickLauncherHotkey,
    );
    autoUpdateController.initialize();
    const startupContextTargetCount = contextDispatchController.queueTargetsFromArgv(
      process.argv,
    );
    if (startupContextTargetCount > 0) {
      windowManager.showMainWindow();
    }

    const bootAppsManager = () => {
      void getAppsManager()
        .initializeAppsManager()
        .catch((error) => {
          console.error("Apps manager init failed:", error);
        });
    };
    const bootAutoStartApps = async () => {
      try {
        const ids = await getAppsManager().listAutoStartApps();
        for (const id of ids) {
          await getAppsManager().startApp(id).catch((err) => {
            console.warn(`[auto-start] Failed to start app "${id}":`, err instanceof Error ? err.message : String(err));
          });
        }
      } catch (err) {
        console.warn("[auto-start] Boot failed:", err instanceof Error ? err.message : String(err));
      }
    };
    const bootSystemAppsIndex = () => {
      void getSystemAppsManager()
        .refreshSystemAppsIndex()
        .catch((error) => {
          console.warn("System apps index init failed:", error);
        });
    };
    const prewarmQuickLauncher = () => {
      try {
        windowManager.prewarmQuickLauncherWindow();
      } catch (error) {
        console.warn("Quick launcher prewarm failed:", error);
      }
    };

    const mainWindow = windowManager.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.once("did-finish-load", () => {
        setTimeout(bootAppsManager, 300);
        setTimeout(bootSystemAppsIndex, 600);
        setTimeout(prewarmQuickLauncher, 800);
        setTimeout(bootAutoStartApps, 2000);
        autoUpdateController.scheduleStartupCheck();
      });
      mainWindow.webContents.once("did-fail-load", () => {
        setTimeout(bootAppsManager, 300);
        setTimeout(bootSystemAppsIndex, 600);
        setTimeout(prewarmQuickLauncher, 800);
        setTimeout(bootAutoStartApps, 2000);
        autoUpdateController.scheduleStartupCheck();
      });
    } else {
      setTimeout(bootAppsManager, 800);
      setTimeout(bootSystemAppsIndex, 1200);
      setTimeout(prewarmQuickLauncher, 1400);
      setTimeout(bootAutoStartApps, 2500);
      autoUpdateController.scheduleStartupCheck();
    }

    app.on("activate", () => {
      windowManager.showMainWindow();
      windowManager.updateTrayMenu();
    });
  });

  app.on("before-quit", () => {
    windowManager.markQuitting();
    windowManager.destroyQuickLauncherWindow();
    windowManager.closeAiChatWindow();
    windowManager.closeSystemRecorderWindow();
    autoUpdateController.cancelStartupCheck();
    contextDispatchController.dispose();
    void systemRecorderManager.dispose();
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    autoUpdateController.dispose();
  });

  app.on("window-all-closed", () => {
    if (process.platform === "darwin" && !windowManager.isQuitting()) {
      return;
    }
  });
}
