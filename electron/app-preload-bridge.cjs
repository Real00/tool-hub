const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("toolHubAppApi", {
  getRuntimeInfo() {
    return ipcRenderer.invoke("app-runtime:get-info");
  },
  subscribeLaunchContext(callback) {
    if (typeof callback !== "function") {
      return () => {};
    }
    const listener = (_event, payload) => {
      callback(payload);
    };
    ipcRenderer.on("app-runtime:launch-context", listener);
    return () => {
      ipcRenderer.removeListener("app-runtime:launch-context", listener);
    };
  },
  notify(title, body, options) {
    return ipcRenderer.invoke("app-runtime:notify", title, body, options);
  },
  files: {
    read(filePath, options) {
      return ipcRenderer.invoke("app-runtime:file-read", filePath, options);
    },
    write(filePath, content, options) {
      return ipcRenderer.invoke("app-runtime:file-write", filePath, content, options);
    },
  },
  systemFiles: {
    read(filePath, options) {
      return ipcRenderer.invoke("app-runtime:system-file-read", filePath, options);
    },
    write(filePath, content, options) {
      return ipcRenderer.invoke("app-runtime:system-file-write", filePath, content, options);
    },
  },
  storage: {
    get(key) {
      return ipcRenderer.invoke("app-runtime:kv-get", key);
    },
    set(key, value) {
      return ipcRenderer.invoke("app-runtime:kv-set", key, value);
    },
    delete(key) {
      return ipcRenderer.invoke("app-runtime:kv-delete", key);
    },
    list(prefix) {
      return ipcRenderer.invoke("app-runtime:kv-list", prefix);
    },
    clear() {
      return ipcRenderer.invoke("app-runtime:kv-clear");
    },
  },
});
