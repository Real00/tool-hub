const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, shell } = require("electron");
const path = require("node:path");

let appsManagerModule = null;
let settingsStoreModule = null;

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

const devServerUrl = process.argv[2];
const isDev = Boolean(devServerUrl);
const APP_NAME = "Tool Hub";
const bootTraceEnabled = process.env.TOOL_HUB_BOOT_LOG === "1";
const bootStartAt = Date.now();

let mainWindow = null;
let tray = null;
let isQuitting = false;
let isClosePromptVisible = false;
const appWindows = new Map();

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

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

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
      win.show();
    }
  }, showTimeoutMs);

  win.once("ready-to-show", () => {
    clearTimeout(showTimer);
    bootTrace("main window ready-to-show");
    if (!win.isDestroyed()) {
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
      win.show();
    }
    console.error("Failed to load main window content:", error);
  });

  return win;
}

async function openAppWindowById(appId) {
  const existing = appWindows.get(appId);
  if (existing && !existing.isDestroyed()) {
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
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  appWindows.set(appId, win);
  win.on("closed", () => {
    appWindows.delete(appId);
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
  win.close();
  appWindows.delete(appId);
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

ipcMain.handle("apps:install-from-directory", async (_event, sourceDir, tabId) => {
  return getAppsManager().installAppFromDirectory(sourceDir, tabId);
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

ipcMain.handle("apps:open-window", async (_event, appId) => {
  return openAppWindowById(appId);
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

app.whenReady().then(() => {
  bootTrace("app.whenReady");
  createMainWindow();
  createTray();

  const bootAppsManager = () => {
    void getAppsManager().initializeAppsManager().catch((error) => {
      console.error("Apps manager init failed:", error);
    });
  };

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(bootAppsManager, 300);
    });
    mainWindow.webContents.once("did-fail-load", () => {
      setTimeout(bootAppsManager, 300);
    });
  } else {
    setTimeout(bootAppsManager, 800);
  }

  app.on("activate", () => {
    showMainWindow();
    updateTrayMenu();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  if (process.platform === "darwin" && !isQuitting) {
    return;
  }
});
