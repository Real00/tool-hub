// @ts-nocheck
function registerAiChatIpc(options = {}) {
  const ipcMain = options.ipcMain;
  const getSettingsStore = options.getSettingsStore;
  const aiChatManager = options.aiChatManager;
  const windowManager = options.windowManager;

  ipcMain.handle("ai-chat:get-settings", async () => {
    return getSettingsStore().getAiChatSettings();
  });

  ipcMain.handle("ai-chat:save-settings", async (_event, input) => {
    return getSettingsStore().saveAiChatSettings(input);
  });

  ipcMain.handle("ai-chat:list-models", async (_event, input) => {
    return aiChatManager.listModels(input);
  });

  ipcMain.handle("ai-chat:list-sessions", async () => {
    return getSettingsStore().listAiChatSessions();
  });

  ipcMain.handle("ai-chat:create-session", async () => {
    return getSettingsStore().createAiChatSession();
  });

  ipcMain.handle("ai-chat:delete-session", async (_event, sessionId) => {
    return getSettingsStore().deleteAiChatSession(sessionId);
  });

  ipcMain.handle("ai-chat:get-session-messages", async (_event, sessionId) => {
    return getSettingsStore().listAiChatSessionMessages(sessionId);
  });

  ipcMain.handle("ai-chat:send-message", async (_event, input) => {
    return aiChatManager.sendMessage(input);
  });

  ipcMain.handle("ai-chat:begin-stream", async (_event, requestId) => {
    return aiChatManager.beginStream(requestId);
  });

  ipcMain.handle("ai-chat:cancel-stream", async (_event, requestId) => {
    return aiChatManager.cancelStream(requestId);
  });

  ipcMain.handle("ai-chat:get-launch-state", async () => {
    return windowManager.getAiChatLaunchState();
  });

  ipcMain.on("ai-chat:stream-subscribe", (event) => {
    aiChatManager.subscribe(event.sender);
  });

  ipcMain.on("ai-chat:stream-unsubscribe", (event) => {
    aiChatManager.unsubscribe(event.sender);
  });
}

module.exports = {
  registerAiChatIpc,
};
