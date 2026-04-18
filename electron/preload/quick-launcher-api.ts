// @ts-nocheck
const { createSimpleSubscription } = require("./api-utils");

function createQuickLauncherApi(ipcRenderer) {
  return {
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
    getQuickLauncherClipboardDeveloperToolsContext() {
      return ipcRenderer.invoke("quick-launcher:get-clipboard-developer-tools-context");
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
  };
}

module.exports = {
  createQuickLauncherApi,
};
