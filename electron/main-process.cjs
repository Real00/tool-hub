const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  shell,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");

let appsManagerModule = null;
let settingsStoreModule = null;
let appGeneratorModule = null;
let systemAppsManagerModule = null;
let autoUpdaterInstance = null;
let autoUpdaterLoadAttempted = false;
let isConfigRestoreInProgress = false;

function assertRestoreAccessAllowed(options = {}) {
  if (options.allowDuringRestore === true) {
    return;
  }
  if (isConfigRestoreInProgress) {
    throw new Error(
      "Configuration restore is in progress. Please retry after restore completes.",
    );
  }
}

function getAppsManager(options = {}) {
  assertRestoreAccessAllowed(options);
  if (!appsManagerModule) {
    appsManagerModule = require("./apps-manager.cjs");
  }
  return appsManagerModule;
}

function getSettingsStore(options = {}) {
  assertRestoreAccessAllowed(options);
  if (!settingsStoreModule) {
    settingsStoreModule = require("./settings-store.cjs");
  }
  return settingsStoreModule;
}

function getAppGenerator(options = {}) {
  assertRestoreAccessAllowed(options);
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
const hasSingleInstanceLock = app.requestSingleInstanceLock();
const bootTraceEnabled = process.env.TOOL_HUB_BOOT_LOG === "1";
const bootStartAt = Date.now();
const APP_RUNTIME_LAUNCH_PAYLOAD_CHANNEL = "app-runtime:launch-payload";
const AUTO_UPDATE_EVENT_CHANNEL = "update:state";
const AUTO_UPDATE_STARTUP_DELAY_MS = 15000;
const QUICK_LAUNCHER_SIZE_COMPACT = "compact";
const QUICK_LAUNCHER_SIZE_EXPANDED = "expanded";

let mainWindow = null;
let quickLauncherWindow = null;
let quickLauncherSizeMode = QUICK_LAUNCHER_SIZE_COMPACT;
let quickLauncherSizeState = {
  mode: QUICK_LAUNCHER_SIZE_COMPACT,
  resultCount: 0,
  showEmptyState: false,
  showPayloadHint: false,
};
let tray = null;
let isQuitting = false;
let isClosePromptVisible = false;
const appWindows = new Map();
const runtimeWindowStateByWebContentsId = new Map();
const terminalSubscriptions = new Map();
const autoUpdateSubscribers = new Set();
let appIcon = null;
let autoUpdateInitialized = false;
let autoUpdateStartupTimer = null;
let autoUpdateCheckInFlight = false;
let autoUpdateDownloadInFlight = false;

const ASSETS_DIR_CANDIDATES = [
  path.join(process.resourcesPath, "assets"),
  path.join(__dirname, "assets"),
];
const APP_ICON_CANDIDATES = [
  "app-icon.ico",
  "app-icon.png",
  "tray-icon.ico",
  "tray-icon.png",
  "tray-icon.svg",
];

function buildInitialAutoUpdateState() {
  if (process.platform !== "win32") {
    return {
      status: "disabled",
      currentVersion: app.getVersion(),
      availableVersion: null,
      downloadedVersion: null,
      releaseName: null,
      releaseDate: null,
      releaseNotes: null,
      lastCheckedAt: null,
      downloadedAt: null,
      progress: null,
      message: "Automatic updates are enabled for Windows builds only.",
    };
  }
  if (isDev) {
    return {
      status: "disabled",
      currentVersion: app.getVersion(),
      availableVersion: null,
      downloadedVersion: null,
      releaseName: null,
      releaseDate: null,
      releaseNotes: null,
      lastCheckedAt: null,
      downloadedAt: null,
      progress: null,
      message: "Automatic updates are disabled in development mode.",
    };
  }
  return {
    status: "idle",
    currentVersion: app.getVersion(),
    availableVersion: null,
    downloadedVersion: null,
    releaseName: null,
    releaseDate: null,
    releaseNotes: null,
    lastCheckedAt: null,
    downloadedAt: null,
    progress: null,
    message: "Waiting for update check.",
  };
}

let autoUpdateState = buildInitialAutoUpdateState();

function getAutoUpdater() {
  if (autoUpdaterLoadAttempted) {
    return autoUpdaterInstance;
  }
  autoUpdaterLoadAttempted = true;

  if (process.platform !== "win32" || isDev) {
    autoUpdaterInstance = null;
    return autoUpdaterInstance;
  }

  try {
    const { autoUpdater } = require("electron-updater");
    autoUpdaterInstance = autoUpdater;
    return autoUpdaterInstance;
  } catch (error) {
    autoUpdaterInstance = null;
    console.warn(
      "electron-updater is unavailable. Update checks will be disabled.",
      error,
    );
    return autoUpdaterInstance;
  }
}

function formatUpdateError(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function normalizeReleaseNotes(value) {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    const notes = value
      .map((item) => {
        if (typeof item === "string") {
          return item.trim();
        }
        if (item && typeof item.note === "string") {
          return item.note.trim();
        }
        return "";
      })
      .filter(Boolean);
    return notes.length > 0 ? notes.join("\n\n") : null;
  }
  return null;
}

function formatReleaseDate(value) {
  if (!value) {
    return null;
  }
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return new Date(timestamp).toISOString();
}

function cloneAutoUpdateState() {
  return {
    ...autoUpdateState,
    progress: autoUpdateState.progress ? { ...autoUpdateState.progress } : null,
  };
}

function emitAutoUpdateState() {
  const payload = cloneAutoUpdateState();
  for (const webContents of autoUpdateSubscribers) {
    if (!webContents || webContents.isDestroyed()) {
      autoUpdateSubscribers.delete(webContents);
      continue;
    }
    webContents.send(AUTO_UPDATE_EVENT_CHANNEL, payload);
  }
}

function patchAutoUpdateState(partial) {
  autoUpdateState = {
    ...autoUpdateState,
    ...partial,
    currentVersion: app.getVersion(),
  };
  emitAutoUpdateState();
}

function ensureAutoUpdateDisabledState(message) {
  patchAutoUpdateState({
    status: "disabled",
    message,
    progress: null,
  });
  return cloneAutoUpdateState();
}

async function checkForAppUpdates(trigger = "manual") {
  const updater = getAutoUpdater();
  if (!updater) {
    if (process.platform !== "win32") {
      return ensureAutoUpdateDisabledState(
        "Automatic updates are enabled for Windows builds only.",
      );
    }
    if (isDev) {
      return ensureAutoUpdateDisabledState(
        "Automatic updates are disabled in development mode.",
      );
    }
    return ensureAutoUpdateDisabledState(
      "electron-updater is unavailable in current runtime.",
    );
  }

  if (autoUpdateCheckInFlight) {
    return cloneAutoUpdateState();
  }
  autoUpdateCheckInFlight = true;
  if (trigger === "manual") {
    patchAutoUpdateState({
      status: "checking",
      message: "Checking for updates...",
      lastCheckedAt: new Date().toISOString(),
      progress: null,
    });
  }

  try {
    await updater.checkForUpdates();
  } catch (error) {
    patchAutoUpdateState({
      status: "error",
      message: `Update check failed: ${formatUpdateError(error)}`,
      progress: null,
    });
  } finally {
    autoUpdateCheckInFlight = false;
  }

  return cloneAutoUpdateState();
}

async function downloadAppUpdate() {
  const updater = getAutoUpdater();
  if (!updater) {
    return ensureAutoUpdateDisabledState(
      "Automatic updates are unavailable in current runtime.",
    );
  }
  if (autoUpdateState.status === "downloaded") {
    return cloneAutoUpdateState();
  }
  if (autoUpdateDownloadInFlight) {
    return cloneAutoUpdateState();
  }

  autoUpdateDownloadInFlight = true;
  patchAutoUpdateState({
    status: "downloading",
    message: "Downloading update package...",
    progress: null,
  });

  try {
    await updater.downloadUpdate();
  } catch (error) {
    patchAutoUpdateState({
      status: "error",
      message: `Update download failed: ${formatUpdateError(error)}`,
      progress: null,
    });
  } finally {
    autoUpdateDownloadInFlight = false;
  }

  return cloneAutoUpdateState();
}

function installAppUpdateAndRestart() {
  const updater = getAutoUpdater();
  if (!updater || autoUpdateState.status !== "downloaded") {
    return false;
  }
  isQuitting = true;
  setImmediate(() => {
    updater.quitAndInstall(false, true);
  });
  return true;
}

function initializeAutoUpdater() {
  if (autoUpdateInitialized) {
    return;
  }
  autoUpdateInitialized = true;

  const updater = getAutoUpdater();
  if (!updater) {
    ensureAutoUpdateDisabledState(
      process.platform !== "win32"
        ? "Automatic updates are enabled for Windows builds only."
        : isDev
          ? "Automatic updates are disabled in development mode."
          : "electron-updater is unavailable in current runtime.",
    );
    return;
  }

  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;

  updater.on("checking-for-update", () => {
    patchAutoUpdateState({
      status: "checking",
      message: "Checking for updates...",
      lastCheckedAt: new Date().toISOString(),
      progress: null,
    });
  });

  updater.on("update-available", (info) => {
    const nextVersion =
      info && typeof info.version === "string" ? info.version : null;
    patchAutoUpdateState({
      status: "available",
      availableVersion: nextVersion,
      downloadedVersion: null,
      downloadedAt: null,
      releaseName:
        info && typeof info.releaseName === "string" ? info.releaseName : null,
      releaseDate: formatReleaseDate(info?.releaseDate),
      releaseNotes: normalizeReleaseNotes(info?.releaseNotes),
      message: nextVersion
        ? `Update ${nextVersion} available. Downloading in background...`
        : "Update available. Downloading in background...",
      progress: null,
    });
  });

  updater.on("update-not-available", () => {
    patchAutoUpdateState({
      status: "up-to-date",
      availableVersion: null,
      downloadedVersion: null,
      downloadedAt: null,
      releaseName: null,
      releaseDate: null,
      releaseNotes: null,
      message: "You are already on the latest version.",
      progress: null,
    });
  });

  updater.on("download-progress", (progress) => {
    const nextProgress = {
      percent: Number(progress?.percent ?? 0),
      transferred: Number(progress?.transferred ?? 0),
      total: Number(progress?.total ?? 0),
      bytesPerSecond: Number(progress?.bytesPerSecond ?? 0),
    };
    patchAutoUpdateState({
      status: "downloading",
      message: `Downloading update: ${nextProgress.percent.toFixed(1)}%`,
      progress: nextProgress,
    });
  });

  updater.on("update-downloaded", (info) => {
    const nextVersion =
      info && typeof info.version === "string" ? info.version : null;
    patchAutoUpdateState({
      status: "downloaded",
      availableVersion: nextVersion,
      downloadedVersion: nextVersion,
      downloadedAt: new Date().toISOString(),
      releaseName:
        info && typeof info.releaseName === "string" ? info.releaseName : null,
      releaseDate: formatReleaseDate(info?.releaseDate),
      releaseNotes: normalizeReleaseNotes(info?.releaseNotes),
      message: nextVersion
        ? `Update ${nextVersion} downloaded. Restart to install.`
        : "Update downloaded. Restart to install.",
      progress: null,
    });
  });

  updater.on("error", (error) => {
    autoUpdateCheckInFlight = false;
    autoUpdateDownloadInFlight = false;
    patchAutoUpdateState({
      status: "error",
      message: `Updater error: ${formatUpdateError(error)}`,
      progress: null,
    });
  });
}

function resolveRendererEntryUrl(hashPath = "/workspace") {
  const normalizedHash = hashPath.startsWith("/") ? hashPath : `/${hashPath}`;
  if (isDev) {
    return `${devServerUrl}#${normalizedHash}`;
  }
  const fileUrl = pathToFileURL(
    path.join(__dirname, "..", "dist", "index.html"),
  ).toString();
  return `${fileUrl}#${normalizedHash}`;
}

function bootTrace(message) {
  if (!bootTraceEnabled) {
    return;
  }
  const elapsed = Date.now() - bootStartAt;
  console.log(`[boot +${elapsed}ms] ${message}`);
}

function createFallbackIcon() {
  const fallbackSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <rect x="4" y="4" width="56" height="56" rx="14" fill="#2563eb"/>
  <g fill="#ffffff">
    <rect x="20" y="18" width="24" height="4" rx="2"/>
    <rect x="20" y="30" width="24" height="4" rx="2"/>
    <rect x="20" y="42" width="24" height="4" rx="2"/>
  </g>
</svg>`;
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(fallbackSvg).toString("base64")}`,
  );
}

function loadIconImage(iconPath) {
  if (!fs.existsSync(iconPath)) {
    return null;
  }
  const ext = path.extname(iconPath).toLowerCase();
  let image = null;
  if (ext === ".svg") {
    const svg = fs.readFileSync(iconPath, "utf8");
    image = nativeImage.createFromDataURL(
      `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    );
  } else {
    image = nativeImage.createFromPath(iconPath);
  }
  if (!image || image.isEmpty()) {
    return null;
  }
  return image;
}

function getAppIcon() {
  if (appIcon && !appIcon.isEmpty()) {
    return appIcon;
  }

  for (const assetsDir of ASSETS_DIR_CANDIDATES) {
    for (const fileName of APP_ICON_CANDIDATES) {
      const iconPath = path.join(assetsDir, fileName);
      const image = loadIconImage(iconPath);
      if (image) {
        appIcon = image;
        return appIcon;
      }
    }
  }

  appIcon = createFallbackIcon();
  return appIcon;
}

function createTrayIcon() {
  const size = process.platform === "win32" ? 16 : 18;
  return getAppIcon().resize({ width: size, height: size, quality: "best" });
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
  const isVisible =
    !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
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
    icon: getAppIcon(),
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

  const loadPromise = win.loadURL(resolveRendererEntryUrl("/workspace"));

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

function normalizeQuickLauncherSizeMode(input) {
  return input === QUICK_LAUNCHER_SIZE_EXPANDED
    ? QUICK_LAUNCHER_SIZE_EXPANDED
    : QUICK_LAUNCHER_SIZE_COMPACT;
}

function normalizeQuickLauncherSizeState(input) {
  if (typeof input === "string") {
    return {
      mode: normalizeQuickLauncherSizeMode(input),
      resultCount: 0,
      showEmptyState: false,
      showPayloadHint: false,
    };
  }

  const state = input && typeof input === "object" ? input : {};
  const numericCount = Number(state.resultCount ?? 0);
  const resultCount = Number.isFinite(numericCount)
    ? Math.max(0, Math.min(20, Math.floor(numericCount)))
    : 0;
  return {
    mode: normalizeQuickLauncherSizeMode(state.mode),
    resultCount,
    showEmptyState: state.showEmptyState === true,
    showPayloadHint: state.showPayloadHint === true,
  };
}

function getQuickLauncherBounds(input = QUICK_LAUNCHER_SIZE_COMPACT) {
  const state = normalizeQuickLauncherSizeState(input);
  const mode = state.mode;
  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);
  const { x, y, width, height } = display.workArea;

  const compactWidth = Math.min(700, Math.max(480, Math.floor(width * 0.36)));
  const expandedWidth = Math.min(860, Math.max(580, Math.floor(width * 0.5)));
  const compactHeight = 52;

  const resultRows = Math.min(state.resultCount, 7);
  const maxVisibleRows = 7;
  const resultPanelHeight = state.resultCount > 0 ? maxVisibleRows * 36 + 4 : 0;
  const emptyPanelHeight = state.showEmptyState ? 66 : 0;
  const payloadHintHeight = state.showPayloadHint ? 22 : 0;
  const expandedContentHeight = Math.max(
    resultPanelHeight,
    emptyPanelHeight,
    payloadHintHeight,
  );
  const expandedHeightBase =
    compactHeight + (expandedContentHeight > 0 ? 4 + expandedContentHeight : 0);
  const expandedHeight = Math.min(
    Math.max(90, expandedHeightBase),
    Math.min(520, Math.floor(height * 0.72)),
  );
  const minimumHeight =
    mode === QUICK_LAUNCHER_SIZE_EXPANDED ? 90 : compactHeight;
  const maximumHeight = Math.min(700, Math.floor(height * 0.9));

  const launcherHeight =
    mode === QUICK_LAUNCHER_SIZE_EXPANDED
      ? expandedHeight
      : compactHeight;

  const launcherWidth =
    mode === QUICK_LAUNCHER_SIZE_EXPANDED ? expandedWidth : compactWidth;
  const launcherX = Math.round(x + (width - launcherWidth) / 2);
  const launcherY = Math.round(
    y +
      (mode === QUICK_LAUNCHER_SIZE_EXPANDED
        ? Math.max(34, Math.floor(height * 0.14))
        : Math.max(24, Math.floor(height * 0.22))),
  );
  return {
    x: launcherX,
    y: launcherY,
    width: launcherWidth,
    height: launcherHeight,
  };
}

function applyQuickLauncherWindowSize(input = QUICK_LAUNCHER_SIZE_COMPACT) {
  const state = normalizeQuickLauncherSizeState(input);
  quickLauncherSizeMode = state.mode;
  quickLauncherSizeState = state;

  const win = quickLauncherWindow;
  if (!win || win.isDestroyed()) {
    return;
  }
  const bounds = getQuickLauncherBounds(state);
  win.setBounds(bounds, true);
}

function closeQuickLauncherWindow() {
  if (!quickLauncherWindow || quickLauncherWindow.isDestroyed()) {
    quickLauncherWindow = null;
    quickLauncherSizeMode = QUICK_LAUNCHER_SIZE_COMPACT;
    quickLauncherSizeState = normalizeQuickLauncherSizeState(
      QUICK_LAUNCHER_SIZE_COMPACT,
    );
    return;
  }
  quickLauncherSizeMode = QUICK_LAUNCHER_SIZE_COMPACT;
  quickLauncherSizeState = normalizeQuickLauncherSizeState(
    QUICK_LAUNCHER_SIZE_COMPACT,
  );
  quickLauncherWindow.close();
}

function createQuickLauncherWindow() {
  if (quickLauncherWindow && !quickLauncherWindow.isDestroyed()) {
    return quickLauncherWindow;
  }

  const bounds = getQuickLauncherBounds(quickLauncherSizeState);
  const win = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    backgroundColor: "#020617",
    icon: getAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload-bridge.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  quickLauncherWindow = win;
  stripWindowMenu(win);
  attachWindowKeyboardShortcuts(win);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  win.on("blur", () => {
    if (isQuitting) {
      return;
    }
    closeQuickLauncherWindow();
  });
  win.on("closed", () => {
    if (quickLauncherWindow === win) {
      quickLauncherWindow = null;
    }
  });

  void win
    .loadURL(resolveRendererEntryUrl("/quick-launcher"))
    .catch((error) => {
      console.error("Failed to load quick launcher window:", error);
      closeQuickLauncherWindow();
    });

  return win;
}

function showQuickLauncherWindow() {
  quickLauncherSizeMode = QUICK_LAUNCHER_SIZE_COMPACT;
  quickLauncherSizeState = normalizeQuickLauncherSizeState(
    QUICK_LAUNCHER_SIZE_COMPACT,
  );
  const win = createQuickLauncherWindow();
  if (!win || win.isDestroyed()) {
    return;
  }

  applyQuickLauncherWindowSize(quickLauncherSizeState);

  if (win.webContents.isLoadingMainFrame()) {
    win.once("ready-to-show", () => {
      if (!win.isDestroyed()) {
        win.show();
        win.focus();
      }
    });
    return;
  }

  win.show();
  win.focus();
}

function emitQuickLauncherOpen() {
  if (
    quickLauncherWindow &&
    !quickLauncherWindow.isDestroyed() &&
    quickLauncherWindow.isVisible()
  ) {
    closeQuickLauncherWindow();
    return;
  }
  showQuickLauncherWindow();
}

function registerQuickLauncherHotkey() {
  const accelerator = "Alt+Space";
  const success = globalShortcut.register(accelerator, () => {
    emitQuickLauncherOpen();
  });
  if (!success) {
    console.warn(
      `[shortcut] Failed to register global shortcut: ${accelerator}`,
    );
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

function setRuntimeWindowLaunchPayload(
  win,
  appId,
  launchPayloadInput,
  emitUpdate = false,
) {
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
    icon: getAppIcon(),
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
  win.webContents.on(
    "console-message",
    (_event, level, message, line, sourceId) => {
      if (level >= 2) {
        console.warn(
          `[app-window:${appId}] console(${level}) ${sourceId}:${line} ${message}`,
        );
      }
    },
  );
  win.webContents.on(
    "did-fail-load",
    (_event, code, description, validatedUrl) => {
      console.error(
        `[app-window:${appId}] did-fail-load code=${code} url=${validatedUrl} ${description}`,
      );
    },
  );
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

function closeAllAppWindows() {
  for (const [appId, win] of appWindows.entries()) {
    if (!win || win.isDestroyed()) {
      appWindows.delete(appId);
      continue;
    }
    runtimeWindowStateByWebContentsId.delete(win.webContents.id);
    win.close();
    appWindows.delete(appId);
  }
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

function pad2(value) {
  return String(value).padStart(2, "0");
}

function buildBackupTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hour = pad2(date.getHours());
  const minute = pad2(date.getMinutes());
  const second = pad2(date.getSeconds());
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function resolveUniquePath(basePath) {
  let resolvedPath = basePath;
  let suffix = 2;
  while (fs.existsSync(resolvedPath)) {
    resolvedPath = `${basePath}-${suffix}`;
    suffix += 1;
  }
  return resolvedPath;
}

function isPathInside(parentPath, targetPath) {
  const relative = path.relative(parentPath, targetPath);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function ensureZipExtension(filePathInput) {
  if (/\.zip$/i.test(filePathInput)) {
    return filePathInput;
  }
  return `${filePathInput}.zip`;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function escapePowerShellSingleQuoted(value) {
  return String(value).replace(/'/g, "''");
}

function runPowerShellWithExecutable(executable, script) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      executable,
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
      ],
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill();
      reject(new Error(`PowerShell command timed out (${executable}).`));
    }, 300000);
    child.stdout.on("data", () => {
      // Drain stdout to avoid pipe backpressure causing hangs.
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `PowerShell command failed (${executable}, code=${code}): ${stderr.trim() || "unknown error"}`,
        ),
      );
    });
  });
}

async function runPowerShell(script) {
  const executables =
    process.platform === "win32"
      ? ["pwsh.exe", "pwsh", "powershell.exe", "powershell"]
      : ["pwsh", "powershell"];
  let lastError = null;

  for (const executable of executables) {
    try {
      await runPowerShellWithExecutable(executable, script);
      return;
    } catch (error) {
      if (error?.code === "ENOENT") {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw (
    lastError ??
    new Error("No PowerShell executable found to process zip archive.")
  );
}

async function compressDirectoryToZip(sourceDir, archivePath) {
  const escapedSource = escapePowerShellSingleQuoted(path.resolve(sourceDir));
  const escapedArchive = escapePowerShellSingleQuoted(path.resolve(archivePath));
  const script =
    `$ErrorActionPreference = 'Stop'; ` +
    `Compress-Archive -Path '${escapedSource}\\*' -DestinationPath '${escapedArchive}' -CompressionLevel Optimal -Force`;
  await runPowerShell(script);
}

async function expandZipArchive(archivePath, destinationDir) {
  const escapedArchive = escapePowerShellSingleQuoted(path.resolve(archivePath));
  const escapedDestination = escapePowerShellSingleQuoted(
    path.resolve(destinationDir),
  );
  const script =
    `$ErrorActionPreference = 'Stop'; ` +
    `Expand-Archive -Path '${escapedArchive}' -DestinationPath '${escapedDestination}' -Force`;
  await runPowerShell(script);
}

async function removePathIfExists(targetPath) {
  const maxAttempts = 10;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await fs.promises.rm(targetPath, {
        recursive: true,
        force: true,
        maxRetries: 4,
        retryDelay: 120,
      });
      return;
    } catch (error) {
      const code = String(error?.code ?? "");
      const retryable =
        code === "ENOTEMPTY" ||
        code === "EPERM" ||
        code === "EBUSY" ||
        code === "EACCES";
      if (!retryable || attempt === maxAttempts) {
        throw error;
      }
      lastError = error;
      await sleep(attempt * 180);
    }
  }
  if (lastError) {
    throw lastError;
  }
}

function copyDirectoryIfExists(sourceDir, destinationDir, includedPaths) {
  if (!fs.existsSync(sourceDir)) {
    return;
  }
  const stat = fs.statSync(sourceDir);
  if (!stat.isDirectory()) {
    return;
  }
  fs.cpSync(sourceDir, destinationDir, {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
  includedPaths.push(destinationDir);
}

function copyFileIfExists(sourceFile, destinationFile, includedPaths) {
  if (!fs.existsSync(sourceFile)) {
    return false;
  }
  const stat = fs.statSync(sourceFile);
  if (!stat.isFile()) {
    return false;
  }
  fs.mkdirSync(path.dirname(destinationFile), { recursive: true });
  fs.copyFileSync(sourceFile, destinationFile);
  includedPaths.push(destinationFile);
  return true;
}

function copySqliteBundleIfExists(sourceDbPath, targetDir, includedPaths) {
  const dbName = path.basename(sourceDbPath);
  const targetDbPath = path.join(targetDir, dbName);
  const copiedMainDb = copyFileIfExists(
    sourceDbPath,
    targetDbPath,
    includedPaths,
  );
  if (!copiedMainDb) {
    return;
  }

  copyFileIfExists(
    `${sourceDbPath}-wal`,
    path.join(targetDir, `${dbName}-wal`),
    includedPaths,
  );
  copyFileIfExists(
    `${sourceDbPath}-shm`,
    path.join(targetDir, `${dbName}-shm`),
    includedPaths,
  );
}

function createBackupSnapshot(snapshotDir) {
  const appsRoot = getAppsManager().resolveAppsRoot();
  const toolHubRoot = path.resolve(path.dirname(appsRoot));
  const settingsDbPath = path.resolve(getSettingsStore().resolveDatabasePath());
  const includedPaths = [];

  fs.mkdirSync(snapshotDir, { recursive: true });
  copyDirectoryIfExists(
    toolHubRoot,
    path.join(snapshotDir, path.basename(toolHubRoot)),
    includedPaths,
  );
  copySqliteBundleIfExists(
    settingsDbPath,
    path.join(snapshotDir, "settings-db"),
    includedPaths,
  );

  const metadataPath = path.join(snapshotDir, "backup-metadata.json");
  fs.writeFileSync(
    metadataPath,
    `${JSON.stringify(
      {
        formatVersion: 2,
        type: "zip-archive",
        createdAt: new Date().toISOString(),
        source: {
          toolHubRoot,
          settingsDbPath,
        },
        includedPaths,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  includedPaths.push(metadataPath);

  return {
    toolHubRoot,
    settingsDbPath,
    includedPaths,
  };
}

async function backupConfigurationData() {
  const defaultArchiveName = `tool-hub-backup-${buildBackupTimestamp()}.zip`;
  const suggestedDir = app.getPath("documents");
  const pickerResult = await dialog.showSaveDialog(mainWindow ?? undefined, {
    title: "保存备份压缩包",
    defaultPath: path.join(suggestedDir, defaultArchiveName),
    buttonLabel: "保存备份",
    filters: [{ name: "Zip Archive", extensions: ["zip"] }],
  });

  if (pickerResult.canceled || !pickerResult.filePath) {
    return {
      canceled: true,
      archivePath: null,
      includedPaths: [],
    };
  }

  const archivePath = ensureZipExtension(path.resolve(pickerResult.filePath));
  const appsRoot = getAppsManager().resolveAppsRoot();
  const toolHubRoot = path.resolve(path.dirname(appsRoot));
  if (isPathInside(toolHubRoot, archivePath)) {
    throw new Error("Backup archive cannot be saved inside .tool-hub directory.");
  }

  const tempRoot = resolveUniquePath(
    path.join(app.getPath("temp"), `tool-hub-backup-${Date.now().toString(36)}`),
  );
  const snapshotDir = path.join(tempRoot, "snapshot");
  let includedPaths = [];

  try {
    const snapshot = createBackupSnapshot(snapshotDir);
    includedPaths = snapshot.includedPaths;
    await removePathIfExists(archivePath);
    await compressDirectoryToZip(snapshotDir, archivePath);
  } finally {
    await removePathIfExists(tempRoot);
  }

  return {
    canceled: false,
    archivePath,
    includedPaths,
  };
}

async function closeStoresForRestore() {
  const appsManager = getAppsManager({ allowDuringRestore: true });
  if (typeof appsManager.closeAppsManager === "function") {
    await appsManager.closeAppsManager();
  }

  const settingsStore = getSettingsStore({ allowDuringRestore: true });
  if (typeof settingsStore.closeSettingsStore === "function") {
    await settingsStore.closeSettingsStore();
  }
}

async function restoreConfigurationFromArchive() {
  if (isConfigRestoreInProgress) {
    throw new Error("Another configuration restore is already in progress.");
  }

  const pickerResult = await dialog.showOpenDialog(mainWindow ?? undefined, {
    title: "选择备份压缩包",
    properties: ["openFile", "dontAddToRecent"],
    filters: [{ name: "Zip Archive", extensions: ["zip"] }],
  });

  if (pickerResult.canceled || pickerResult.filePaths.length === 0) {
    return {
      canceled: true,
      restored: false,
      archivePath: null,
      restoredPaths: [],
      restartRecommended: false,
    };
  }

  const archivePath = path.resolve(pickerResult.filePaths[0]);
  const tempRoot = resolveUniquePath(
    path.join(
      app.getPath("temp"),
      `tool-hub-restore-${Date.now().toString(36)}`,
    ),
  );
  const extractDir = path.join(tempRoot, "extract");
  const restoredPaths = [];
  isConfigRestoreInProgress = true;

  try {
    fs.mkdirSync(extractDir, { recursive: true });
    await expandZipArchive(archivePath, extractDir);

    const extractedToolHubRoot = path.join(extractDir, ".tool-hub");
    if (
      !fs.existsSync(extractedToolHubRoot) ||
      !fs.statSync(extractedToolHubRoot).isDirectory()
    ) {
      throw new Error(
        "Invalid backup archive: missing .tool-hub directory in archive root.",
      );
    }

    closeQuickLauncherWindow();
    closeAllAppWindows();
    await closeStoresForRestore();
    await sleep(350);

    const appsManager = getAppsManager({ allowDuringRestore: true });
    const settingsStore = getSettingsStore({ allowDuringRestore: true });
    const liveToolHubRoot = path.resolve(
      path.dirname(appsManager.resolveAppsRoot()),
    );
    const liveSettingsDbPath = path.resolve(
      settingsStore.resolveDatabasePath(),
    );
    const liveSettingsDbName = path.basename(liveSettingsDbPath);

    await removePathIfExists(liveToolHubRoot);
    fs.mkdirSync(path.dirname(liveToolHubRoot), { recursive: true });
    fs.cpSync(extractedToolHubRoot, liveToolHubRoot, {
      recursive: true,
      force: true,
    });
    restoredPaths.push(liveToolHubRoot);

    const extractedSettingsDbDir = path.join(extractDir, "settings-db");
    const extractedSettingsDbPath = path.join(
      extractedSettingsDbDir,
      liveSettingsDbName,
    );
    if (fs.existsSync(extractedSettingsDbPath)) {
      await removePathIfExists(liveSettingsDbPath);
      await removePathIfExists(`${liveSettingsDbPath}-wal`);
      await removePathIfExists(`${liveSettingsDbPath}-shm`);
      copyFileIfExists(extractedSettingsDbPath, liveSettingsDbPath, restoredPaths);
      copyFileIfExists(
        path.join(extractedSettingsDbDir, `${liveSettingsDbName}-wal`),
        `${liveSettingsDbPath}-wal`,
        restoredPaths,
      );
      copyFileIfExists(
        path.join(extractedSettingsDbDir, `${liveSettingsDbName}-shm`),
        `${liveSettingsDbPath}-shm`,
        restoredPaths,
      );
    }

    await Promise.allSettled([
      appsManager.initializeAppsManager(),
      settingsStore.initializeSettingsStore(),
    ]);

    return {
      canceled: false,
      restored: true,
      archivePath,
      restoredPaths,
      restartRecommended: true,
    };
  } finally {
    try {
      await removePathIfExists(tempRoot);
    } finally {
      isConfigRestoreInProgress = false;
    }
  }
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

ipcMain.handle("settings:backup-config", async () => {
  return backupConfigurationData();
});

ipcMain.handle("settings:restore-config", async () => {
  return restoreConfigurationFromArchive();
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

ipcMain.handle(
  "generator:install-project",
  async (_event, projectId, tabId, overwriteExisting) => {
    return getAppGenerator().installProjectApp(
      getAppsManager(),
      projectId,
      tabId,
      overwriteExisting,
    );
  },
);

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
  closeAppWindowById(appId);
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

ipcMain.handle(
  "app-runtime:file-write",
  async (event, filePath, content, options) => {
    const appId = requireRuntimeAppId(event);
    return getAppsManager().writeAppFile(appId, filePath, content, options);
  },
);

ipcMain.handle(
  "app-runtime:system-file-read",
  async (event, filePath, options) => {
    const appId = requireRuntimeAppId(event);
    return getAppsManager().readSystemFile(appId, filePath, options);
  },
);

ipcMain.handle(
  "app-runtime:system-file-write",
  async (event, filePath, content, options) => {
    const appId = requireRuntimeAppId(event);
    return getAppsManager().writeSystemFile(appId, filePath, content, options);
  },
);

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

ipcMain.handle("quick-launcher:close", async () => {
  closeQuickLauncherWindow();
  return true;
});

ipcMain.handle("quick-launcher:set-size", async (_event, mode) => {
  applyQuickLauncherWindowSize(mode);
  return true;
});

ipcMain.handle("update:get-state", async () => {
  return cloneAutoUpdateState();
});

ipcMain.handle("update:check", async () => {
  return checkForAppUpdates("manual");
});

ipcMain.handle("update:download", async () => {
  return downloadAppUpdate();
});

ipcMain.handle("update:install", async () => {
  return installAppUpdateAndRestart();
});

ipcMain.on("update:subscribe", (event) => {
  const webContents = event.sender;
  autoUpdateSubscribers.add(webContents);
  webContents.once("destroyed", () => {
    autoUpdateSubscribers.delete(webContents);
  });
  webContents.send(AUTO_UPDATE_EVENT_CHANNEL, cloneAutoUpdateState());
});

ipcMain.on("update:unsubscribe", (event) => {
  autoUpdateSubscribers.delete(event.sender);
});

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!app.isReady()) {
      app.once("ready", () => {
        showMainWindow();
        updateTrayMenu();
      });
      return;
    }
    showMainWindow();
    updateTrayMenu();
  });

  app.whenReady().then(() => {
    bootTrace("app.whenReady");
    Menu.setApplicationMenu(null);
    createMainWindow();
    createTray();
    registerQuickLauncherHotkey();
    initializeAutoUpdater();

    const bootAppsManager = () => {
      void getAppsManager()
        .initializeAppsManager()
        .catch((error) => {
          console.error("Apps manager init failed:", error);
        });
    };
    const bootSystemAppsIndex = () => {
      void getSystemAppsManager()
        .refreshSystemAppsIndex()
        .catch((error) => {
          console.warn("System apps index init failed:", error);
        });
    };

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.once("did-finish-load", () => {
        setTimeout(bootAppsManager, 300);
        setTimeout(bootSystemAppsIndex, 600);
        if (autoUpdateStartupTimer) {
          clearTimeout(autoUpdateStartupTimer);
        }
        autoUpdateStartupTimer = setTimeout(() => {
          void checkForAppUpdates("startup");
        }, AUTO_UPDATE_STARTUP_DELAY_MS);
      });
      mainWindow.webContents.once("did-fail-load", () => {
        setTimeout(bootAppsManager, 300);
        setTimeout(bootSystemAppsIndex, 600);
        if (autoUpdateStartupTimer) {
          clearTimeout(autoUpdateStartupTimer);
        }
        autoUpdateStartupTimer = setTimeout(() => {
          void checkForAppUpdates("startup");
        }, AUTO_UPDATE_STARTUP_DELAY_MS);
      });
    } else {
      setTimeout(bootAppsManager, 800);
      setTimeout(bootSystemAppsIndex, 1200);
      if (autoUpdateStartupTimer) {
        clearTimeout(autoUpdateStartupTimer);
      }
      autoUpdateStartupTimer = setTimeout(() => {
        void checkForAppUpdates("startup");
      }, AUTO_UPDATE_STARTUP_DELAY_MS);
    }

    app.on("activate", () => {
      showMainWindow();
      updateTrayMenu();
    });
  });

  app.on("before-quit", () => {
    isQuitting = true;
    closeQuickLauncherWindow();
    if (autoUpdateStartupTimer) {
      clearTimeout(autoUpdateStartupTimer);
      autoUpdateStartupTimer = null;
    }
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });

  app.on("window-all-closed", () => {
    if (process.platform === "darwin" && !isQuitting) {
      return;
    }
  });
}
