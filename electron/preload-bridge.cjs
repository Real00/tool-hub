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
  refreshSystemAppsIndex() {
    return ipcRenderer.invoke("system-apps:refresh");
  },
  searchSystemApps(query, limit) {
    return ipcRenderer.invoke("system-apps:search", query, limit);
  },
  getSystemAppsByIds(appIds) {
    return ipcRenderer.invoke("system-apps:get-by-ids", appIds);
  },
  openSystemApp(appId, launchPayload) {
    return ipcRenderer.invoke("system-apps:open", appId, launchPayload);
  },
  getSystemRecorderState() {
    return ipcRenderer.invoke("system-recorder:get-state");
  },
  listSystemRecorderSources(mode) {
    return ipcRenderer.invoke("system-recorder:list-sources", mode);
  },
  prepareSystemRecorderPreview(input) {
    return ipcRenderer.invoke("system-recorder:prepare-preview", input);
  },
  startSystemRecorder(input) {
    return ipcRenderer.invoke("system-recorder:start", input);
  },
  appendSystemRecorderChunk(sessionId, chunk) {
    return ipcRenderer.invoke("system-recorder:append-chunk", sessionId, chunk);
  },
  finishSystemRecorder(sessionId) {
    return ipcRenderer.invoke("system-recorder:finish", sessionId);
  },
  abortSystemRecorder(sessionId, errorMessage) {
    return ipcRenderer.invoke("system-recorder:abort", sessionId, errorMessage);
  },
  pickSystemRecorderFfmpegPath() {
    return ipcRenderer.invoke("system-recorder:pick-ffmpeg-path");
  },
  setSystemRecorderFfmpegPath(filePath) {
    return ipcRenderer.invoke("system-recorder:set-ffmpeg-path", filePath);
  },
  closeQuickLauncherWindow() {
    return ipcRenderer.invoke("quick-launcher:close");
  },
  getQuickLauncherHotkeyState() {
    return ipcRenderer.invoke("quick-launcher:get-hotkey-state");
  },
  saveQuickLauncherHotkey(accelerator) {
    return ipcRenderer.invoke("quick-launcher:save-hotkey", accelerator);
  },
  applyQuickLauncherHotkey(accelerator) {
    return ipcRenderer.invoke("quick-launcher:apply-hotkey", accelerator);
  },
  retryQuickLauncherHotkey() {
    return ipcRenderer.invoke("quick-launcher:retry-hotkey");
  },
  getQuickLauncherClipboardPathContext() {
    return ipcRenderer.invoke("quick-launcher:get-clipboard-path-context");
  },
  openClipboardPathFile(targetPath) {
    return ipcRenderer.invoke("quick-launcher:open-clipboard-path-file", targetPath);
  },
  openClipboardPathLocation(targetPath) {
    return ipcRenderer.invoke("quick-launcher:open-clipboard-path-location", targetPath);
  },
  setQuickLauncherWindowSize(payload) {
    return ipcRenderer.invoke("quick-launcher:set-size", payload);
  },
  getAiChatSettings() {
    return ipcRenderer.invoke("ai-chat:get-settings");
  },
  saveAiChatSettings(input) {
    return ipcRenderer.invoke("ai-chat:save-settings", input);
  },
  listAiChatModels(input) {
    return ipcRenderer.invoke("ai-chat:list-models", input);
  },
  listAiChatSessions() {
    return ipcRenderer.invoke("ai-chat:list-sessions");
  },
  createAiChatSession() {
    return ipcRenderer.invoke("ai-chat:create-session");
  },
  deleteAiChatSession(sessionId) {
    return ipcRenderer.invoke("ai-chat:delete-session", sessionId);
  },
  getAiChatSessionMessages(sessionId) {
    return ipcRenderer.invoke("ai-chat:get-session-messages", sessionId);
  },
  sendAiChatMessage(input) {
    return ipcRenderer.invoke("ai-chat:send-message", input);
  },
  beginAiChatStream(requestId) {
    return ipcRenderer.invoke("ai-chat:begin-stream", requestId);
  },
  cancelAiChatStream(requestId) {
    return ipcRenderer.invoke("ai-chat:cancel-stream", requestId);
  },
  getAiChatLaunchState() {
    return ipcRenderer.invoke("ai-chat:get-launch-state");
  },
  subscribeAiChatStream(callback) {
    if (typeof callback !== "function") {
      return () => {};
    }
    const listener = (_event, payload) => {
      callback(payload);
    };
    ipcRenderer.on("ai-chat:stream", listener);
    ipcRenderer.send("ai-chat:stream-subscribe");
    return () => {
      ipcRenderer.send("ai-chat:stream-unsubscribe");
      ipcRenderer.removeListener("ai-chat:stream", listener);
    };
  },
  subscribeAiChatLaunch(callback) {
    if (typeof callback !== "function") {
      return () => {};
    }
    const listener = (_event, payload) => {
      callback(payload);
    };
    ipcRenderer.on("ai-chat:launch", listener);
    return () => {
      ipcRenderer.removeListener("ai-chat:launch", listener);
    };
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
