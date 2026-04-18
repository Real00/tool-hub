// @ts-nocheck
function registerSystemIpc(options = {}) {
  const ipcMain = options.ipcMain;
  const getSystemAppsManager = options.getSystemAppsManager;
  const systemRecorderManager = options.systemRecorderManager;
  const windowManager = options.windowManager;

  ipcMain.handle("system-apps:refresh", async () => {
    return getSystemAppsManager().refreshSystemAppsIndex();
  });

  ipcMain.handle("system-apps:search", async (_event, query, limit) => {
    return getSystemAppsManager().searchSystemApps(query, limit);
  });

  ipcMain.handle("system-apps:list", async () => {
    return getSystemAppsManager().listSystemApps();
  });

  ipcMain.handle("system-apps:get-by-ids", async (_event, appIds) => {
    return getSystemAppsManager().getSystemAppsByIds(appIds);
  });

  ipcMain.handle("system-apps:open", async (_event, appId, launchPayload) => {
    if (systemRecorderManager.isRecorderSystemAppId(appId)) {
      windowManager.showSystemRecorderWindow(appId);
      return true;
    }
    if (appId === "builtin:developer-tools") {
      windowManager.showDeveloperToolsWindow(
        launchPayload,
        launchPayload ? "quick-launcher" : "manual",
      );
      return true;
    }
    if (appId === "builtin:ai-chat") {
      windowManager.showAiChatWindow(
        launchPayload,
        launchPayload ? "quick-launcher" : "manual",
      );
      return true;
    }
    return getSystemAppsManager().openSystemApp(appId, launchPayload);
  });

  ipcMain.handle("system-recorder:get-state", async () => {
    return systemRecorderManager.getRecorderState();
  });

  ipcMain.handle("system-recorder:list-sources", async (_event, mode) => {
    return systemRecorderManager.listRecorderSources(mode);
  });

  ipcMain.handle("system-recorder:prepare-preview", async (_event, input) => {
    return systemRecorderManager.preparePreviewCapture(input);
  });

  ipcMain.handle("system-recorder:start", async (_event, input) => {
    return systemRecorderManager.startRecorder(input);
  });

  ipcMain.handle("system-recorder:append-chunk", async (_event, sessionId, chunk) => {
    return systemRecorderManager.appendRecordingChunk(sessionId, chunk);
  });

  ipcMain.handle("system-recorder:finish", async (_event, sessionId) => {
    return systemRecorderManager.finishRecorder(sessionId);
  });

  ipcMain.handle("system-recorder:abort", async (_event, sessionId, errorMessage) => {
    return systemRecorderManager.abortRecorder(sessionId, errorMessage);
  });

  ipcMain.handle("system-recorder:pick-ffmpeg-path", async () => {
    return systemRecorderManager.pickAndSaveFfmpegPath();
  });

  ipcMain.handle("system-recorder:set-ffmpeg-path", async (_event, filePath) => {
    return systemRecorderManager.setFfmpegPath(filePath);
  });
}

module.exports = {
  registerSystemIpc,
};
