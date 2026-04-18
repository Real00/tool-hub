// @ts-nocheck
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

const { createAutoUpdateController } = require("./main-process/auto-update");
const { createAiChatManager } = require("./ai-chat-manager");
const {
  analyzeDeveloperToolsText,
  getQuickLauncherClipboardDeveloperToolsContext,
  runDeveloperToolsTransform,
} = require("./developer-tools-manager");
const { createWindowManager } = require("./main-process/window-manager");
const { createAppRuntimeWindowsController } = require("./main-process/app-runtime-windows");
const { createContextDispatchController } = require("./main-process/context-dispatch");
const { createConfigRestoreController } = require("./main-process/config-restore");
const { createSystemRecorderManager } = require("./system-recorder-manager");
const { registerCoreIpc } = require("./main-process/ipc/core-ipc");
const { registerSettingsIpc } = require("./main-process/ipc/settings-ipc");
const { registerGeneratorIpc } = require("./main-process/ipc/generator-ipc");
const { registerAppsIpc } = require("./main-process/ipc/apps-ipc");
const { registerSystemIpc } = require("./main-process/ipc/system-ipc");
const { registerQuickLauncherIpc } = require("./main-process/ipc/quick-launcher-ipc");
const { registerAiChatIpc } = require("./main-process/ipc/ai-chat-ipc");
const { registerDeveloperToolsIpc } = require("./main-process/ipc/developer-tools-ipc");
const { registerUpdateIpc } = require("./main-process/ipc/update-ipc");

// Lazily loaded heavy modules; restore flow temporarily gates access.
let appsManagerModule = null;
let settingsStoreModule = null;
let appGeneratorModule = null;
let systemAppsManagerModule = null;
let windowsContextMenuModule = null;

function loadAppsManagerModule() {
  if (!appsManagerModule) {
    appsManagerModule = require("./apps-manager");
  }
  return appsManagerModule;
}

function loadSettingsStoreModule() {
  if (!settingsStoreModule) {
    settingsStoreModule = require("./settings-store");
  }
  return settingsStoreModule;
}

function loadAppGeneratorModule() {
  if (!appGeneratorModule) {
    appGeneratorModule = require("./app-generator");
  }
  return appGeneratorModule;
}

function getSystemAppsManager() {
  if (!systemAppsManagerModule) {
    systemAppsManagerModule = require("./system-apps-manager");
  }
  return systemAppsManagerModule;
}

function getWindowsContextMenu() {
  if (!windowsContextMenuModule) {
    windowsContextMenuModule = require("./windows-context-menu");
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

registerCoreIpc({
  ipcMain,
  contextDispatchController,
  getSettingsStore,
});

registerSettingsIpc({
  ipcMain,
  getSettingsStore,
  configRestoreController,
});

registerGeneratorIpc({
  ipcMain,
  getAppGenerator,
  getAppsManager,
  getSettingsStore,
});

registerAppsIpc({
  ipcMain,
  dialog,
  getAppsManager,
  appRuntimeController,
  contextDispatchController,
  appLogEventChannel: APP_LOG_EVENT_CHANNEL,
  appName: APP_NAME,
  getMainWindow: () => windowManager.getMainWindow(),
});

registerSystemIpc({
  ipcMain,
  getSystemAppsManager,
  systemRecorderManager,
  windowManager,
});

registerQuickLauncherIpc({
  ipcMain,
  clipboard,
  windowManager,
  getSettingsStore,
  normalizeQuickLauncherHotkey,
  getQuickLauncherClipboardPathContext,
  getQuickLauncherClipboardDeveloperToolsContext,
  openClipboardPathFile,
  openClipboardPathLocation,
});

registerAiChatIpc({
  ipcMain,
  getSettingsStore,
  aiChatManager,
  windowManager,
});

registerDeveloperToolsIpc({
  ipcMain,
  analyzeDeveloperToolsText,
  runDeveloperToolsTransform,
  windowManager,
});

registerUpdateIpc({
  ipcMain,
  autoUpdateController,
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
    windowManager.closeDeveloperToolsWindow();
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
