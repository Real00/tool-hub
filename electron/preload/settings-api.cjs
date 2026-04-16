function createSettingsApi(ipcRenderer) {
  return {
    getSettingsTabs() {
      return ipcRenderer.invoke("settings:get-tabs");
    },
    saveSettingsTabs(tabs) {
      return ipcRenderer.invoke("settings:save-tabs", tabs);
    },
    initializeSettingsDatabase() {
      return ipcRenderer.invoke("settings:initialize-db");
    },
    backupConfiguration() {
      return ipcRenderer.invoke("settings:backup-config");
    },
    restoreConfigurationFromArchive() {
      return ipcRenderer.invoke("settings:restore-config");
    },
  };
}

module.exports = {
  createSettingsApi,
};
