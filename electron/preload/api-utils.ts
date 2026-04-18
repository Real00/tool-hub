// @ts-nocheck
function noop() {}

function createFilteredSubscription(ipcRenderer, channel, filter, callback, options = {}) {
  if (typeof callback !== "function") {
    return noop;
  }

  const listener = (_event, payload) => {
    if (!filter || filter(payload)) {
      callback(payload);
    }
  };

  ipcRenderer.on(channel, listener);
  if (options.subscribeChannel) {
    ipcRenderer.send(options.subscribeChannel, options.subscribeArg);
  }

  return () => {
    if (options.unsubscribeChannel) {
      ipcRenderer.send(options.unsubscribeChannel, options.subscribeArg);
    }
    ipcRenderer.removeListener(channel, listener);
  };
}

function createSimpleSubscription(ipcRenderer, channel, callback, options = {}) {
  if (typeof callback !== "function") {
    return noop;
  }

  const listener = (_event, payload) => {
    callback(payload);
  };

  ipcRenderer.on(channel, listener);
  if (options.subscribeChannel) {
    ipcRenderer.send(options.subscribeChannel);
  }

  return () => {
    if (options.unsubscribeChannel) {
      ipcRenderer.send(options.unsubscribeChannel);
    }
    ipcRenderer.removeListener(channel, listener);
  };
}

module.exports = {
  createFilteredSubscription,
  createSimpleSubscription,
};
