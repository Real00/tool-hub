// @ts-nocheck
const { createFilteredSubscription } = require("./api-utils");

function createAppsApi(ipcRenderer) {
  return {
    getAppsRoot() {
      return ipcRenderer.invoke("apps:get-root");
    },
    listApps() {
      return ipcRenderer.invoke("apps:list");
    },
    initializeAppsDatabase() {
      return ipcRenderer.invoke("apps:initialize-db");
    },
    installAppFromDirectory(sourceDir, tabId, overwriteExisting) {
      return ipcRenderer.invoke("apps:install-from-directory", sourceDir, tabId, overwriteExisting);
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
    getAppRuns(appId, limit) {
      return ipcRenderer.invoke("apps:get-runs", appId, limit);
    },
    updateAppTab(appId, tabId) {
      return ipcRenderer.invoke("apps:update-tab", appId, tabId);
    },
    setAppAutoStart(appId, enabled) {
      return ipcRenderer.invoke("apps:set-auto-start", appId, enabled);
    },
    listAppKv(appId) {
      return ipcRenderer.invoke("apps:kv-list", appId);
    },
    deleteAppKvEntry(appId, key) {
      return ipcRenderer.invoke("apps:kv-delete", appId, key);
    },
    clearAppKv(appId) {
      return ipcRenderer.invoke("apps:kv-clear", appId);
    },
    batchStopApps(appIds) {
      return ipcRenderer.invoke("apps:batch-stop", appIds);
    },
    batchRemoveApps(appIds, options) {
      return ipcRenderer.invoke("apps:batch-remove", appIds, options);
    },
    subscribeAppLogs(appId, callback) {
      return createFilteredSubscription(
        ipcRenderer,
        "apps:log-event",
        (payload) => payload?.appId === appId,
        callback,
        {
          subscribeChannel: "apps:logs-subscribe",
          unsubscribeChannel: "apps:logs-unsubscribe",
          subscribeArg: appId,
        },
      );
    },
    removeApp(appId, options) {
      return ipcRenderer.invoke("apps:remove", appId, options);
    },
    openAppWindow(appId, launchContext) {
      return ipcRenderer.invoke("apps:open-window", appId, launchContext);
    },
    dispatchAppCapability(payload) {
      return ipcRenderer.invoke("apps:dispatch-capability", payload);
    },
    pickInstallDirectory() {
      return ipcRenderer.invoke("apps:pick-install-directory");
    },
  };
}

module.exports = {
  createAppsApi,
};
