function registerDeveloperToolsIpc(options = {}) {
  const ipcMain = options.ipcMain;
  const analyzeDeveloperToolsText = options.analyzeDeveloperToolsText;
  const runDeveloperToolsTransform = options.runDeveloperToolsTransform;
  const windowManager = options.windowManager;

  ipcMain.handle("developer-tools:analyze-text", async (_event, text) => {
    return analyzeDeveloperToolsText(text);
  });

  ipcMain.handle("developer-tools:run-transform", async (_event, text, transformId) => {
    return runDeveloperToolsTransform(text, transformId);
  });

  ipcMain.handle("developer-tools:get-launch-state", async () => {
    return windowManager.getDeveloperToolsLaunchState();
  });
}

module.exports = {
  registerDeveloperToolsIpc,
};
