const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("toolHubApi", {
  ping(name) {
    return ipcRenderer.invoke("tool-hub:ping", name);
  },
  getSettingsTabs() {
    return ipcRenderer.invoke("settings:get-tabs");
  },
  saveSettingsTabs(tabs) {
    return ipcRenderer.invoke("settings:save-tabs", tabs);
  },
  initializeSettingsDatabase() {
    return ipcRenderer.invoke("settings:initialize-db");
  },
  getAppsRoot() {
    return ipcRenderer.invoke("apps:get-root");
  },
  listApps() {
    return ipcRenderer.invoke("apps:list");
  },
  initializeAppsDatabase() {
    return ipcRenderer.invoke("apps:initialize-db");
  },
  installAppFromDirectory(sourceDir, tabId) {
    return ipcRenderer.invoke("apps:install-from-directory", sourceDir, tabId);
  },
  startApp(appId) {
    return ipcRenderer.invoke("apps:start", appId);
  },
  stopApp(appId) {
    return ipcRenderer.invoke("apps:stop", appId);
  },
  getAppLogs(appId) {
    return ipcRenderer.invoke("apps:get-logs", appId);
  },
  removeApp(appId) {
    return ipcRenderer.invoke("apps:remove", appId);
  },
  openAppWindow(appId) {
    return ipcRenderer.invoke("apps:open-window", appId);
  },
  pickInstallDirectory() {
    return ipcRenderer.invoke("apps:pick-install-directory");
  },
});
