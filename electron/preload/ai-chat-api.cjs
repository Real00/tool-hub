const { createSimpleSubscription } = require("./api-utils.cjs");

function createAiChatApi(ipcRenderer) {
  return {
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
      return createSimpleSubscription(ipcRenderer, "ai-chat:stream", callback, {
        subscribeChannel: "ai-chat:stream-subscribe",
        unsubscribeChannel: "ai-chat:stream-unsubscribe",
      });
    },
    subscribeAiChatLaunch(callback) {
      return createSimpleSubscription(ipcRenderer, "ai-chat:launch", callback);
    },
  };
}

module.exports = {
  createAiChatApi,
};
