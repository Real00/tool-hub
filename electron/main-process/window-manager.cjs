// Owns the shell-level UI windows: main window, tray, and quick launcher.
function createWindowManager(options = {}) {
  const app = options.app;
  const BrowserWindow = options.BrowserWindow;
  const Menu = options.Menu;
  const Tray = options.Tray;
  const dialog = options.dialog;
  const nativeImage = options.nativeImage;
  const screen = options.screen;
  const shell = options.shell;
  const fs = options.fs;
  const path = options.path;
  const pathToFileURL = options.pathToFileURL;
  const electronRootDir = options.electronRootDir
    ? path.resolve(String(options.electronRootDir))
    : path.join(__dirname, "..");
  const appName = String(options.appName || "Tool Hub");
  const isDev = options.isDev === true;
  const devServerUrl = String(options.devServerUrl || "");
  const bootTrace =
    typeof options.bootTrace === "function" ? options.bootTrace : () => {};
  const onRequestQuit =
    typeof options.onRequestQuit === "function"
      ? options.onRequestQuit
      : () => {
          app.quit();
        };

  const QUICK_LAUNCHER_SIZE_COMPACT = "compact";
  const QUICK_LAUNCHER_SIZE_EXPANDED = "expanded";

  const ASSETS_DIR_CANDIDATES = [
    path.join(process.resourcesPath, "assets"),
    path.join(electronRootDir, "assets"),
  ];
  const APP_ICON_CANDIDATES = [
    "app-icon.ico",
    "app-icon.png",
    "tray-icon.ico",
    "tray-icon.png",
    "tray-icon.svg",
  ];

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
  let appIcon = null;
  let isQuitting = false;
  let isClosePromptVisible = false;
  let flushContextDispatch = () => {};

  // Context dispatch is owned by another module; this callback avoids a direct dependency.
  function setContextDispatchFlusher(callback) {
    flushContextDispatch =
      typeof callback === "function" ? callback : () => {};
  }

  function resolveRendererEntryUrl(hashPath = "/workspace") {
    const normalizedHash = hashPath.startsWith("/") ? hashPath : `/${hashPath}`;
    if (isDev) {
      return `${devServerUrl}#${normalizedHash}`;
    }
    const fileUrl = pathToFileURL(
      path.join(electronRootDir, "..", "dist", "index.html"),
    ).toString();
    return `${fileUrl}#${normalizedHash}`;
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

  function requestQuit() {
    isQuitting = true;
    onRequestQuit();
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
        preload: path.join(electronRootDir, "preload-bridge.cjs"),
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
      flushContextDispatch();
    });
    win.on("close", (event) => {
      if (isQuitting) {
        return;
      }
      // Intercept normal close so users can keep background runtime via tray.
      event.preventDefault();
      if (isClosePromptVisible) {
        return;
      }
      isClosePromptVisible = true;

      void dialog
        .showMessageBox(win, {
          type: "question",
          title: appName,
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
            requestQuit();
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
    flushContextDispatch();
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
          requestQuit();
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
    tray.setToolTip(appName);
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

    // Height adapts to search result payload while clamping to screen work area.
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

    const launcherHeight =
      mode === QUICK_LAUNCHER_SIZE_EXPANDED ? expandedHeight : compactHeight;

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
    // Reset mode/state even if no window exists so the next open starts compact.
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
        preload: path.join(electronRootDir, "preload-bridge.cjs"),
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

    void win.loadURL(resolveRendererEntryUrl("/quick-launcher")).catch((error) => {
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

  function registerQuickLauncherHotkey(globalShortcut) {
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

  function setQuickLauncherWindowSize(mode) {
    applyQuickLauncherWindowSize(mode);
  }

  function markQuitting() {
    isQuitting = true;
  }

  function isAppQuitting() {
    return isQuitting;
  }

  function getMainWindow() {
    return mainWindow;
  }

  return {
    setContextDispatchFlusher,
    createMainWindow,
    showMainWindow,
    hideMainWindow,
    createTray,
    updateTrayMenu,
    registerQuickLauncherHotkey,
    closeQuickLauncherWindow,
    setQuickLauncherWindowSize,
    stripWindowMenu,
    attachWindowKeyboardShortcuts,
    getAppIcon,
    markQuitting,
    isQuitting: isAppQuitting,
    getMainWindow,
  };
}

module.exports = {
  createWindowManager,
};
