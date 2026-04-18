// @ts-nocheck
function registerSettingsIpc(options = {}) {
  const ipcMain = options.ipcMain;
  const getSettingsStore = options.getSettingsStore;
  const configRestoreController = options.configRestoreController;

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
}

module.exports = {
  registerSettingsIpc,
};
