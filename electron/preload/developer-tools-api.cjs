const { createSimpleSubscription, createFilteredSubscription } = require("./api-utils.cjs");

function createDeveloperToolsApi(ipcRenderer) {
  return {
    analyzeDeveloperToolsText(text) {
      return ipcRenderer.invoke("developer-tools:analyze-text", text);
    },
    runDeveloperToolsTransform(text, transformId) {
      return ipcRenderer.invoke("developer-tools:run-transform", text, transformId);
    },
    getDeveloperToolsLaunchState() {
      return ipcRenderer.invoke("developer-tools:get-launch-state");
    },
    subscribeDeveloperToolsLaunch(callback) {
      return createSimpleSubscription(ipcRenderer, "developer-tools:launch", callback);
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
  };
}

module.exports = {
  createDeveloperToolsApi,
};
