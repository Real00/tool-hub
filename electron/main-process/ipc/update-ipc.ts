// @ts-nocheck
function registerUpdateIpc(options = {}) {
  const ipcMain = options.ipcMain;
  const autoUpdateController = options.autoUpdateController;

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
}

module.exports = {
  registerUpdateIpc,
};
