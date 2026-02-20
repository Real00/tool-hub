const { app, BrowserWindow, Menu, Tray, dialog, globalShortcut, ipcMain, nativeImage, shell } = require("electron");
const path = require("node:path");

let appsManagerModule = null;
let settingsStoreModule = null;
let appGeneratorModule = null;
let systemAppsManagerModule = null;

function getAppsManager() {
  if (!appsManagerModule) {
    appsManagerModule = require("./apps-manager.cjs");
  }
  return appsManagerModule;
}

function getSettingsStore() {
  if (!settingsStoreModule) {
    settingsStoreModule = require("./settings-store.cjs");
  }
  return settingsStoreModule;
}

function getAppGenerator() {
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

const devServerUrl = process.argv[2];
const isDev = Boolean(devServerUrl);
const APP_NAME = "Tool Hub";
const bootTraceEnabled = process.env.TOOL_HUB_BOOT_LOG === "1";
const bootStartAt = Date.now();
const APP_RUNTIME_LAUNCH_PAYLOAD_CHANNEL = "app-runtime:launch-payload";

let mainWindow = null;
let tray = null;
let isQuitting = false;
let isClosePromptVisible = false;
const appWindows = new Map();
const runtimeWindowStateByWebContentsId = new Map();
const terminalSubscriptions = new Map();

function bootTrace(message) {
  if (!bootTraceEnabled) {
    return;
  }
  const elapsed = Date.now() - bootStartAt;
  console.log(`[boot +${elapsed}ms] ${message}`);
}

function createTrayIcon() {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <rect x="6" y="6" width="52" height="52" rx="12" fill="#0f172a"/>
  <path d="M18 22h28v6H35v26h-6V28H18z" fill="#67e8f9"/>
</svg>`;

  const image = nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
  );
  return image.resize({ width: 16, height: 16 });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
    updateTrayMenu();
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function hideMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
}

function buildTrayMenu() {
  const isVisible = !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
  return Menu.buildFromTemplate([
    {
      label: isVisible ? "隐藏窗口" : "打开窗口",
      click: () => {
        if (isVisible) {
          hideMainWindow();
        } else {
          showMainWindow();
        }
        updateTrayMenu();
      },
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function updateTrayMenu() {
  if (!tray) {
    return;
  }
  tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip(APP_NAME);
  updateTrayMenu();

  tray.on("click", () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      hideMainWindow();
    } else {
      showMainWindow();
    }
    updateTrayMenu();
  });

  tray.on("double-click", () => {
    showMainWindow();
    updateTrayMenu();
  });
}

function stripWindowMenu(win) {
  if (!win || win.isDestroyed()) {
    return;
  }
  if (typeof win.removeMenu === "function") {
    win.removeMenu();
  }
  win.setMenuBarVisibility(false);
}

function attachWindowKeyboardShortcuts(win) {
  win.webContents.on("before-input-event", (event, input) => {
    const isF12 =
      input.type === "keyDown" &&
      !input.alt &&
      !input.control &&
      !input.meta &&
      !input.shift &&
      (input.code === "F12" || input.key === "F12");
    if (isF12) {
      event.preventDefault();
      win.webContents.openDevTools({ mode: "detach", activate: true });
      return;
    }

    const isAltSpace =
      input.type === "keyDown" &&
      input.alt &&
      !input.control &&
      !input.meta &&
      !input.shift &&
      (input.code === "Space" || input.key === " ");
    if (isAltSpace) {
      // Prevent the native Windows system menu (Restore/Minimize/Close) from opening.
      event.preventDefault();
    }
  });
}

function createMainWindow() {
  bootTrace(`createMainWindow (isDev=${isDev})`);
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: "#020617",
    webPreferences: {
      preload: path.join(__dirname, "preload-bridge.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;
  stripWindowMenu(win);
  win.maximize();

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  attachWindowKeyboardShortcuts(win);

  win.on("show", updateTrayMenu);
  win.on("hide", updateTrayMenu);
  win.webContents.on("did-start-loading", () => {
    bootTrace("main window did-start-loading");
  });
  win.webContents.on("dom-ready", () => {
    bootTrace("main window dom-ready");
  });
  win.webContents.on("did-finish-load", () => {
    bootTrace("main window did-finish-load");
  });
  win.on("close", (event) => {
    if (isQuitting) {
      return;
    }
    event.preventDefault();
    if (isClosePromptVisible) {
      return;
    }
    isClosePromptVisible = true;

    void dialog
      .showMessageBox(win, {
        type: "question",
        title: APP_NAME,
        message: "关闭应用时要执行什么操作？",
        detail: "你可以最小化到托盘继续后台运行，或者完全退出程序。",
        buttons: ["最小化到托盘", "退出", "取消"],
        defaultId: isDev ? 1 : 0,
        cancelId: 2,
        noLink: true,
      })
      .then(({ response }) => {
        if (response === 0) {
          win.hide();
          updateTrayMenu();
          return;
        }

        if (response === 1) {
          isQuitting = true;
          app.quit();
        }
      })
      .finally(() => {
        isClosePromptVisible = false;
      });
  });
  win.on("closed", () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
    updateTrayMenu();
  });

  const showTimeoutMs = isDev ? 30000 : 10000;
  const showTimer = setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) {
      win.maximize();
      win.show();
    }
  }, showTimeoutMs);

  win.once("ready-to-show", () => {
    clearTimeout(showTimer);
    bootTrace("main window ready-to-show");
    if (!win.isDestroyed()) {
      win.maximize();
      win.show();
    }
  });

  const loadPromise = isDev
    ? win.loadURL(devServerUrl)
    : win.loadFile(path.join(__dirname, "..", "dist", "index.html"));

  void loadPromise.catch((error) => {
    clearTimeout(showTimer);
    bootTrace("main window load failed");
    if (!win.isDestroyed()) {
      win.maximize();
      win.show();
    }
    console.error("Failed to load main window content:", error);
  });

  return win;
}

function emitQuickLauncherOpen() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    showMainWindow();
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  showMainWindow();

  if (mainWindow.webContents.isLoadingMainFrame()) {
    mainWindow.webContents.once("did-finish-load", () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("quick-launcher:open");
      }
    });
    return;
  }

  mainWindow.webContents.send("quick-launcher:open");
}

function registerQuickLauncherHotkey() {
  const accelerator = "Alt+Space";
  const success = globalShortcut.register(accelerator, () => {
    emitQuickLauncherOpen();
  });
  if (!success) {
    console.warn(`[shortcut] Failed to register global shortcut: ${accelerator}`);
  }
}

function normalizeLaunchPayload(input) {
  if (input === undefined || input === null) {
    return { provided: input !== undefined, value: null };
  }
  const text = String(input).trim();
  return {
    provided: true,
    value: text ? text : null,
  };
}

function getRuntimeStateByWebContents(webContents) {
  if (!webContents || webContents.isDestroyed()) {
    return null;
  }
  return runtimeWindowStateByWebContentsId.get(webContents.id) ?? null;
}

function setRuntimeWindowLaunchPayload(win, appId, launchPayloadInput, emitUpdate = false) {
  if (!win || win.isDestroyed()) {
    return;
  }

  const webContents = win.webContents;
  const webContentsId = webContents.id;
  const previous = runtimeWindowStateByWebContentsId.get(webContentsId) ?? null;
  const normalized = normalizeLaunchPayload(launchPayloadInput);
  const next = previous
    ? { ...previous }
    : {
        appId,
        launchPayload: null,
        launchPayloadUpdatedAt: Date.now(),
      };

  next.appId = appId;
  if (normalized.provided || !previous) {
    next.launchPayload = normalized.value;
    next.launchPayloadUpdatedAt = Date.now();
  }

  runtimeWindowStateByWebContentsId.set(webContentsId, next);

  if (emitUpdate && normalized.provided && !webContents.isDestroyed()) {
    webContents.send(APP_RUNTIME_LAUNCH_PAYLOAD_CHANNEL, {
      launchPayload: next.launchPayload,
      launchPayloadUpdatedAt: next.launchPayloadUpdatedAt,
    });
  }
}

async function openAppWindowById(appId, launchPayloadInput) {
  const existing = appWindows.get(appId);
  if (existing && !existing.isDestroyed()) {
    setRuntimeWindowLaunchPayload(existing, appId, launchPayloadInput, true);
    if (existing.isMinimized()) {
      existing.restore();
    }
    existing.show();
    existing.focus();
    return true;
  }

  const appInfo = await getAppsManager().getAppById(appId);
  if (!appInfo) {
    throw new Error(`App not found: ${appId}`);
  }
  if (!appInfo.uiUrl) {
    throw new Error("App has no uiPath/uiUrl configured.");
  }

  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: "#020617",
    title: `${appInfo.name} - Tool Hub`,
    webPreferences: {
      preload: path.join(__dirname, "app-preload-bridge.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  appWindows.set(appId, win);
  setRuntimeWindowLaunchPayload(win, appId, launchPayloadInput, false);
  stripWindowMenu(win);
  attachWindowKeyboardShortcuts(win);
  const webContentsId = win.webContents.id;
  win.on("closed", () => {
    appWindows.delete(appId);
    runtimeWindowStateByWebContentsId.delete(webContentsId);
  });
  win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level >= 2) {
      console.warn(`[app-window:${appId}] console(${level}) ${sourceId}:${line} ${message}`);
    }
  });
  win.webContents.on("did-fail-load", (_event, code, description, validatedUrl) => {
    console.error(`[app-window:${appId}] did-fail-load code=${code} url=${validatedUrl} ${description}`);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    console.error(
      `[app-window:${appId}] render-process-gone reason=${details?.reason ?? "unknown"} exitCode=${details?.exitCode ?? "unknown"}`,
    );
  });
  void win.loadURL(appInfo.uiUrl);
  return true;
}

function closeAppWindowById(appId) {
  const win = appWindows.get(appId);
  if (!win || win.isDestroyed()) {
    appWindows.delete(appId);
    return;
  }
  runtimeWindowStateByWebContentsId.delete(win.webContents.id);
  win.close();
  appWindows.delete(appId);
}

function getRuntimeAppIdByWebContents(webContents) {
  if (!webContents || webContents.isDestroyed()) {
    return null;
  }
  const webContentsId = webContents.id;
  const runtimeState = runtimeWindowStateByWebContentsId.get(webContentsId);
  if (runtimeState?.appId) {
    return runtimeState.appId;
  }
  for (const [appId, win] of appWindows.entries()) {
    if (!win || win.isDestroyed()) {
      continue;
    }
    if (win.webContents.id === webContentsId) {
      return appId;
    }
  }
  return null;
}

function requireRuntimeAppId(event) {
  const appId = getRuntimeAppIdByWebContents(event.sender);
  if (!appId) {
    throw new Error("Unauthorized app runtime request.");
  }
  return appId;
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

ipcMain.handle("generator:read-project-file", async (_event, projectId, filePath) => {
  return getAppGenerator().readProjectFile(projectId, filePath);
});

ipcMain.handle("generator:chat-project", async (_event, projectId, message, cliPathOverride) => {
  return getAppGenerator().chatInProject(
    getSettingsStore(),
    projectId,
    message,
    cliPathOverride,
  );
});

ipcMain.handle("generator:install-project", async (_event, projectId, tabId, overwriteExisting) => {
  return getAppGenerator().installProjectApp(getAppsManager(), projectId, tabId, overwriteExisting);
});

ipcMain.handle("generator:get-terminal", async (_event, projectId) => {
  return getAppGenerator().getProjectTerminal(projectId);
});

ipcMain.handle("generator:start-terminal", async (_event, projectId) => {
  return getAppGenerator().startProjectTerminal(projectId);
});

ipcMain.handle("generator:terminal-input", async (_event, projectId, text, appendNewline) => {
  return getAppGenerator().sendProjectTerminalInput(projectId, text, appendNewline);
});

ipcMain.handle("generator:stop-terminal", async (_event, projectId) => {
  return getAppGenerator().stopProjectTerminal(projectId);
});

ipcMain.handle("generator:resize-terminal", async (_event, projectId, cols, rows) => {
  return getAppGenerator().resizeProjectTerminal(projectId, cols, rows);
});

ipcMain.on("generator:terminal-subscribe", (event, projectId) => {
  const webContents = event.sender;
  const webContentsId = webContents.id;
  const key = makeTerminalSubscriptionKey(webContentsId, projectId);
  removeTerminalSubscription(webContentsId, projectId);

  const unsubscribe = getAppGenerator().subscribeProjectTerminal(projectId, (payload) => {
    if (webContents.isDestroyed()) {
      removeTerminalSubscription(webContentsId, projectId);
      return;
    }
    webContents.send("generator:terminal-output", payload);
  });
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

ipcMain.handle("apps:install-from-directory", async (_event, sourceDir, tabId, overwriteExisting) => {
  return getAppsManager().installAppFromDirectory(sourceDir, tabId, overwriteExisting);
});

ipcMain.handle("apps:start", async (_event, appId) => {
  return getAppsManager().startApp(appId);
});

ipcMain.handle("apps:stop", async (_event, appId) => {
  return getAppsManager().stopApp(appId);
});

ipcMain.handle("apps:get-logs", (_event, appId) => {
  return getAppsManager().getAppLogs(appId);
});

ipcMain.handle("apps:remove", async (_event, appId) => {
  closeAppWindowById(appId);
  return getAppsManager().removeApp(appId);
});

ipcMain.handle("apps:open-window", async (_event, appId, launchPayload) => {
  return openAppWindowById(appId, launchPayload);
});

ipcMain.handle("app-runtime:get-info", async (event) => {
  const appId = requireRuntimeAppId(event);
  const runtimeState = getRuntimeStateByWebContents(event.sender);
  return {
    appId,
    launchPayload: runtimeState?.launchPayload ?? null,
    launchPayloadUpdatedAt: runtimeState?.launchPayloadUpdatedAt ?? null,
  };
});

ipcMain.handle("app-runtime:kv-get", async (event, key) => {
  const appId = requireRuntimeAppId(event);
  return getAppsManager().getAppStorageValue(appId, key);
});

ipcMain.handle("app-runtime:kv-set", async (event, key, value) => {
  const appId = requireRuntimeAppId(event);
  return getAppsManager().setAppStorageValue(appId, key, value);
});

ipcMain.handle("app-runtime:kv-delete", async (event, key) => {
  const appId = requireRuntimeAppId(event);
  return getAppsManager().deleteAppStorageKey(appId, key);
});

ipcMain.handle("app-runtime:kv-list", async (event, prefix) => {
  const appId = requireRuntimeAppId(event);
  return getAppsManager().listAppStorage(appId, prefix);
});

ipcMain.handle("app-runtime:kv-clear", async (event) => {
  const appId = requireRuntimeAppId(event);
  return getAppsManager().clearAppStorage(appId);
});

ipcMain.handle("app-runtime:file-read", async (event, filePath, options) => {
  const appId = requireRuntimeAppId(event);
  return getAppsManager().readAppFile(appId, filePath, options);
});

ipcMain.handle("app-runtime:file-write", async (event, filePath, content, options) => {
  const appId = requireRuntimeAppId(event);
  return getAppsManager().writeAppFile(appId, filePath, content, options);
});

ipcMain.handle("app-runtime:system-file-read", async (event, filePath, options) => {
  const appId = requireRuntimeAppId(event);
  return getAppsManager().readSystemFile(appId, filePath, options);
});

ipcMain.handle("app-runtime:system-file-write", async (event, filePath, content, options) => {
  const appId = requireRuntimeAppId(event);
  return getAppsManager().writeSystemFile(appId, filePath, content, options);
});

ipcMain.handle("apps:pick-install-directory", async () => {
  const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
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

ipcMain.handle("system-apps:open", async (_event, appId, launchPayload) => {
  return getSystemAppsManager().openSystemApp(appId, launchPayload);
});

app.whenReady().then(() => {
  bootTrace("app.whenReady");
  Menu.setApplicationMenu(null);
  createMainWindow();
  createTray();
  registerQuickLauncherHotkey();

  const bootAppsManager = () => {
    void getAppsManager().initializeAppsManager().catch((error) => {
      console.error("Apps manager init failed:", error);
    });
  };
  const bootSystemAppsIndex = () => {
    void getSystemAppsManager().refreshSystemAppsIndex().catch((error) => {
      console.warn("System apps index init failed:", error);
    });
  };

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(bootAppsManager, 300);
      setTimeout(bootSystemAppsIndex, 600);
    });
    mainWindow.webContents.once("did-fail-load", () => {
      setTimeout(bootAppsManager, 300);
      setTimeout(bootSystemAppsIndex, 600);
    });
  } else {
    setTimeout(bootAppsManager, 800);
    setTimeout(bootSystemAppsIndex, 1200);
  }

  app.on("activate", () => {
    showMainWindow();
    updateTrayMenu();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform === "darwin" && !isQuitting) {
    return;
  }
});
