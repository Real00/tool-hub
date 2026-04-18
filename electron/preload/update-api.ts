// @ts-nocheck
const { createSimpleSubscription } = require("./api-utils");

function createUpdateApi(ipcRenderer) {
  return {
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
      return createSimpleSubscription(ipcRenderer, "update:state", callback, {
        subscribeChannel: "update:subscribe",
        unsubscribeChannel: "update:unsubscribe",
      });
    },
  };
}

module.exports = {
  createUpdateApi,
};
