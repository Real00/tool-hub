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
  generatorChatInProject(projectId, message, cliPathOverride) {
    return ipcRenderer.invoke("generator:chat-project", projectId, message, cliPathOverride);
  },
  installGeneratorProjectApp(projectId, tabId, overwriteExisting) {
    return ipcRenderer.invoke("generator:install-project", projectId, tabId, overwriteExisting);
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
  removeApp(appId) {
    return ipcRenderer.invoke("apps:remove", appId);
  },
  openAppWindow(appId) {
    return ipcRenderer.invoke("apps:open-window", appId);
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
  openSystemApp(appId) {
    return ipcRenderer.invoke("system-apps:open", appId);
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
});
