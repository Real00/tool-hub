// @ts-nocheck
function registerCoreIpc(options = {}) {
  const ipcMain = options.ipcMain;
  const contextDispatchController = options.contextDispatchController;
  const getSettingsStore = options.getSettingsStore;

  ipcMain.handle("context-dispatch:consume-pending", async () => {
    return contextDispatchController.consumePending();
  });

  ipcMain.handle("tool-hub:ping", (_event, name) => {
    const dbPath = getSettingsStore().resolveDatabasePath();
    return `Electron backend is online: ${name} (sqlite: ${dbPath})`;
  });
}

module.exports = {
  registerCoreIpc,
};
