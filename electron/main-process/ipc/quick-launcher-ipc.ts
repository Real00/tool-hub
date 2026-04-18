// @ts-nocheck
function registerQuickLauncherIpc(options = {}) {
  const ipcMain = options.ipcMain;
  const clipboard = options.clipboard;
  const windowManager = options.windowManager;
  const getSettingsStore = options.getSettingsStore;
  const normalizeQuickLauncherHotkey = options.normalizeQuickLauncherHotkey;
  const getQuickLauncherClipboardPathContext = options.getQuickLauncherClipboardPathContext;
  const getQuickLauncherClipboardDeveloperToolsContext =
    options.getQuickLauncherClipboardDeveloperToolsContext;
  const openClipboardPathFile = options.openClipboardPathFile;
  const openClipboardPathLocation = options.openClipboardPathLocation;

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

  ipcMain.handle("quick-launcher:get-clipboard-developer-tools-context", async () => {
    return getQuickLauncherClipboardDeveloperToolsContext(clipboard.readText());
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
}

module.exports = {
  registerQuickLauncherIpc,
};
