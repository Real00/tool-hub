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
  backupConfiguration() {
    return ipcRenderer.invoke("settings:backup-config");
  },
  restoreConfigurationFromArchive() {
    return ipcRenderer.invoke("settings:restore-config");
  },
  getGeneratorSettings() {
    return ipcRenderer.invoke("generator:get-settings");
  },
  saveGeneratorSettings(input) {
    return ipcRenderer.invoke("generator:save-settings", input);
  },
  detectClaudeCli() {
    return ipcRenderer.invoke("generator:detect-claude-cli");
  },
  createGeneratorProject(projectName) {
    return ipcRenderer.invoke("generator:create-project", projectName);
  },
  getGeneratorProject(projectId) {
    return ipcRenderer.invoke("generator:get-project", projectId);
  },
  listGeneratorProjects() {
    return ipcRenderer.invoke("generator:list-projects");
  },
  readGeneratorProjectFile(projectId, filePath) {
    return ipcRenderer.invoke("generator:read-project-file", projectId, filePath);
  },
  updateGeneratorProjectAgents(projectId) {
    return ipcRenderer.invoke("generator:update-project-agents", projectId);
  },
  installGeneratorProjectApp(projectId, tabId, overwriteExisting, verifyCommandOverride) {
    return ipcRenderer.invoke(
      "generator:install-project",
      projectId,
      tabId,
      overwriteExisting,
      verifyCommandOverride,
    );
  },
  validateGeneratorProject(projectId, tabId) {
    return ipcRenderer.invoke("generator:validate-project", projectId, tabId);
  },
  runGeneratorProjectVerify(projectId, commandOverride) {
    return ipcRenderer.invoke("generator:run-verify", projectId, commandOverride);
  },
  getGeneratorProjectTerminal(projectId) {
    return ipcRenderer.invoke("generator:get-terminal", projectId);
  },
  startGeneratorProjectTerminal(projectId) {
    return ipcRenderer.invoke("generator:start-terminal", projectId);
  },
  sendGeneratorProjectTerminalInput(projectId, text, appendNewline) {
    return ipcRenderer.invoke("generator:terminal-input", projectId, text, appendNewline);
  },
  stopGeneratorProjectTerminal(projectId) {
    return ipcRenderer.invoke("generator:stop-terminal", projectId);
  },
  resizeGeneratorProjectTerminal(projectId, cols, rows) {
    return ipcRenderer.invoke("generator:resize-terminal", projectId, cols, rows);
  },
  subscribeGeneratorProjectTerminal(projectId, callback) {
    if (typeof callback !== "function") {
      return () => {};
    }
    const listener = (_event, payload) => {
      if (payload?.projectId === projectId) {
        callback(payload);
      }
    };
    ipcRenderer.on("generator:terminal-output", listener);
    ipcRenderer.send("generator:terminal-subscribe", projectId);
    return () => {
      ipcRenderer.send("generator:terminal-unsubscribe", projectId);
      ipcRenderer.removeListener("generator:terminal-output", listener);
    };
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
  batchStopApps(appIds) {
    return ipcRenderer.invoke("apps:batch-stop", appIds);
  },
  batchRemoveApps(appIds) {
    return ipcRenderer.invoke("apps:batch-remove", appIds);
  },
  subscribeAppLogs(appId, callback) {
    if (typeof callback !== "function") {
      return () => {};
    }
    const listener = (_event, payload) => {
      if (payload?.appId === appId) {
        callback(payload);
      }
    };
    ipcRenderer.on("apps:log-event", listener);
    ipcRenderer.send("apps:logs-subscribe", appId);
    return () => {
      ipcRenderer.send("apps:logs-unsubscribe", appId);
      ipcRenderer.removeListener("apps:log-event", listener);
    };
  },
  removeApp(appId) {
    return ipcRenderer.invoke("apps:remove", appId);
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
  refreshSystemAppsIndex() {
    return ipcRenderer.invoke("system-apps:refresh");
  },
  searchSystemApps(query, limit) {
    return ipcRenderer.invoke("system-apps:search", query, limit);
  },
  openSystemApp(appId, launchPayload) {
    return ipcRenderer.invoke("system-apps:open", appId, launchPayload);
  },
  closeQuickLauncherWindow() {
    return ipcRenderer.invoke("quick-launcher:close");
  },
  setQuickLauncherWindowSize(payload) {
    return ipcRenderer.invoke("quick-launcher:set-size", payload);
  },
  getUpdateState() {
    return ipcRenderer.invoke("update:get-state");
  },
  checkForUpdates() {
    return ipcRenderer.invoke("update:check");
  },
  downloadUpdate() {
    return ipcRenderer.invoke("update:download");
  },
  installUpdateAndRestart() {
    return ipcRenderer.invoke("update:install");
  },
  subscribeUpdateEvents(callback) {
    if (typeof callback !== "function") {
      return () => {};
    }
    const listener = (_event, payload) => {
      callback(payload);
    };
    ipcRenderer.on("update:state", listener);
    ipcRenderer.send("update:subscribe");
    return () => {
      ipcRenderer.send("update:unsubscribe");
      ipcRenderer.removeListener("update:state", listener);
    };
  },
  subscribeQuickLauncherRequest(callback) {
    if (typeof callback !== "function") {
      return () => {};
    }
    const listener = () => {
      callback();
    };
    ipcRenderer.on("quick-launcher:open", listener);
    return () => {
      ipcRenderer.removeListener("quick-launcher:open", listener);
    };
  },
  subscribeContextDispatchRequest(callback) {
    if (typeof callback !== "function") {
      return () => {};
    }
    const seenRequestIds = new Set();
    const emitPayload = (payload) => {
      const requestId = String(payload?.requestId ?? "").trim();
      if (requestId) {
        if (seenRequestIds.has(requestId)) {
          return;
        }
        seenRequestIds.add(requestId);
      }
      callback(payload);
    };
    const listener = (_event, payload) => {
      emitPayload(payload);
    };
    ipcRenderer.on("context-dispatch:request", listener);
    void ipcRenderer
      .invoke("context-dispatch:consume-pending")
      .then((items) => {
        if (!Array.isArray(items)) {
          return;
        }
        items.forEach((item) => {
          emitPayload(item);
        });
      })
      .catch(() => {});
    return () => {
      ipcRenderer.removeListener("context-dispatch:request", listener);
    };
  },
});
