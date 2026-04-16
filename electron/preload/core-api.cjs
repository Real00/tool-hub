function createCoreApi(ipcRenderer) {
  return {
    ping(name) {
      return ipcRenderer.invoke("tool-hub:ping", name);
    },
  };
}

module.exports = {
  createCoreApi,
};
