function createSystemApi(ipcRenderer) {
  return {
    refreshSystemAppsIndex() {
      return ipcRenderer.invoke("system-apps:refresh");
    },
    listSystemApps() {
      return ipcRenderer.invoke("system-apps:list");
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
  };
}

module.exports = {
  createSystemApi,
};
