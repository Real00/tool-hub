function registerAppsIpc(options = {}) {
  const ipcMain = options.ipcMain;
  const dialog = options.dialog;
  const getAppsManager = options.getAppsManager;
  const appRuntimeController = options.appRuntimeController;
  const contextDispatchController = options.contextDispatchController;
  const appLogEventChannel = String(options.appLogEventChannel || "apps:log-event");
  const appName = String(options.appName || "Tool Hub");
  const getMainWindow = options.getMainWindow;

  const appLogSubscriptions = new Map();

  function makeAppLogSubscriptionKey(webContentsId, appId) {
    return `${webContentsId}:${appId}`;
  }

  function removeAppLogSubscription(webContentsId, appId) {
    const key = makeAppLogSubscriptionKey(webContentsId, appId);
    const unsubscribe = appLogSubscriptions.get(key);
    if (!unsubscribe) {
      return;
    }
    appLogSubscriptions.delete(key);
    try {
      unsubscribe();
    } catch {
      // Ignore cleanup errors.
    }
  }

  function removeAllAppLogSubscriptionsForWebContents(webContentsId) {
    const prefix = `${webContentsId}:`;
    Array.from(appLogSubscriptions.keys())
      .filter((key) => key.startsWith(prefix))
      .forEach((key) => {
        const unsubscribe = appLogSubscriptions.get(key);
        appLogSubscriptions.delete(key);
        try {
          unsubscribe?.();
        } catch {
          // Ignore cleanup errors.
        }
      });
  }

  ipcMain.handle("apps:get-root", () => {
    const appsManager = getAppsManager();
    return {
      appsRoot: appsManager.resolveAppsRoot(),
      dbPath: appsManager.resolveAppsDbPath(),
    };
  });

  ipcMain.handle("apps:list", async () => {
    return getAppsManager().listApps();
  });

  ipcMain.handle("apps:initialize-db", async () => {
    return getAppsManager().initializeAppsDatabase();
  });

  ipcMain.handle(
    "apps:install-from-directory",
    async (_event, sourceDir, tabId, overwriteExisting) => {
      return getAppsManager().installAppFromDirectory(
        sourceDir,
        tabId,
        overwriteExisting,
      );
    },
  );

  ipcMain.handle("apps:start", async (_event, appId) => {
    return getAppsManager().startApp(appId);
  });

  ipcMain.handle("apps:stop", async (_event, appId) => {
    appRuntimeController.closeAppWindowById(appId);
    return getAppsManager().stopApp(appId);
  });

  ipcMain.handle("apps:batch-stop", async (_event, appIds) => {
    if (Array.isArray(appIds)) {
      appIds.forEach((appId) => appRuntimeController.closeAppWindowById(appId));
    }
    return getAppsManager().stopApps(appIds);
  });

  ipcMain.handle("apps:get-logs", (_event, appId) => {
    return getAppsManager().getAppLogs(appId);
  });

  ipcMain.handle("apps:get-runs", (_event, appId, limit) => {
    return getAppsManager().getAppRuns(appId, limit);
  });

  ipcMain.handle("apps:update-tab", async (_event, appId, tabId) => {
    return getAppsManager().updateAppTab(appId, tabId);
  });

  ipcMain.handle("apps:set-auto-start", async (_event, appId, enabled) => {
    return getAppsManager().setAppAutoStart(appId, enabled);
  });

  ipcMain.handle("apps:kv-list", async (_event, appId) => {
    return getAppsManager().listAppStorage(appId);
  });

  ipcMain.handle("apps:kv-delete", async (_event, appId, key) => {
    return getAppsManager().deleteAppStorageKey(appId, key);
  });

  ipcMain.handle("apps:kv-clear", async (_event, appId) => {
    return getAppsManager().clearAppStorage(appId);
  });

  ipcMain.handle("apps:remove", async (_event, appId, optionsInput) => {
    appRuntimeController.closeAppWindowById(appId);
    return getAppsManager().removeApp(appId, optionsInput);
  });

  ipcMain.handle("apps:batch-remove", async (_event, appIds, optionsInput) => {
    if (Array.isArray(appIds)) {
      appIds.forEach((appId) => appRuntimeController.closeAppWindowById(appId));
    }
    return getAppsManager().removeApps(appIds, optionsInput);
  });

  ipcMain.handle("apps:open-window", async (_event, appId, launchContext) => {
    return appRuntimeController.openAppWindowById(appId, launchContext);
  });

  ipcMain.handle("apps:dispatch-capability", async (_event, payload) => {
    try {
      return await contextDispatchController.dispatchCapabilitySelection(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appRuntimeController.showSystemNotification(
        appName,
        `Capability dispatch failed: ${message}`,
      );
      throw error;
    }
  });

  ipcMain.on("apps:logs-subscribe", (event, appId) => {
    const webContents = event.sender;
    const webContentsId = webContents.id;
    const key = makeAppLogSubscriptionKey(webContentsId, appId);
    removeAppLogSubscription(webContentsId, appId);

    const unsubscribe = getAppsManager().subscribeAppLogs(appId, (payload) => {
      if (webContents.isDestroyed()) {
        removeAppLogSubscription(webContentsId, appId);
        return;
      }
      webContents.send(appLogEventChannel, payload);
    });
    appLogSubscriptions.set(key, unsubscribe);

    webContents.once("destroyed", () => {
      removeAllAppLogSubscriptionsForWebContents(webContentsId);
    });
  });

  ipcMain.on("apps:logs-unsubscribe", (event, appId) => {
    removeAppLogSubscription(event.sender.id, appId);
  });

  ipcMain.handle("app-runtime:get-info", async (event) => {
    return appRuntimeController.getRuntimeInfo(event);
  });

  ipcMain.handle("app-runtime:notify", async (event, titleInput, bodyInput, notifyOptions) => {
    return appRuntimeController.notify(event, titleInput, bodyInput, notifyOptions);
  });

  ipcMain.handle("app-runtime:pick-directory", async (event, optionsInput) => {
    return appRuntimeController.pickDirectoryForEvent(event, optionsInput);
  });

  ipcMain.handle("app-runtime:kv-get", async (event, key) => {
    const appId = appRuntimeController.requireRuntimeAppId(event);
    return getAppsManager().getAppStorageValue(appId, key);
  });

  ipcMain.handle("app-runtime:kv-set", async (event, key, value) => {
    const appId = appRuntimeController.requireRuntimeAppId(event);
    return getAppsManager().setAppStorageValue(appId, key, value);
  });

  ipcMain.handle("app-runtime:kv-delete", async (event, key) => {
    const appId = appRuntimeController.requireRuntimeAppId(event);
    return getAppsManager().deleteAppStorageKey(appId, key);
  });

  ipcMain.handle("app-runtime:kv-list", async (event, prefix) => {
    const appId = appRuntimeController.requireRuntimeAppId(event);
    return getAppsManager().listAppStorage(appId, prefix);
  });

  ipcMain.handle("app-runtime:kv-clear", async (event) => {
    const appId = appRuntimeController.requireRuntimeAppId(event);
    return getAppsManager().clearAppStorage(appId);
  });

  ipcMain.handle("app-runtime:file-read", async (event, filePath, optionsInput) => {
    const appId = appRuntimeController.requireRuntimeAppId(event);
    return getAppsManager().readAppFile(appId, filePath, optionsInput);
  });

  ipcMain.handle(
    "app-runtime:file-write",
    async (event, filePath, content, optionsInput) => {
      const appId = appRuntimeController.requireRuntimeAppId(event);
      return getAppsManager().writeAppFile(appId, filePath, content, optionsInput);
    },
  );

  ipcMain.handle(
    "app-runtime:system-file-read",
    async (event, filePath, optionsInput) => {
      const appId = appRuntimeController.requireRuntimeAppId(event);
      return getAppsManager().readSystemFile(appId, filePath, optionsInput);
    },
  );

  ipcMain.handle(
    "app-runtime:system-file-write",
    async (event, filePath, content, optionsInput) => {
      const appId = appRuntimeController.requireRuntimeAppId(event);
      return getAppsManager().writeSystemFile(appId, filePath, content, optionsInput);
    },
  );

  ipcMain.handle("apps:pick-install-directory", async () => {
    const result = await dialog.showOpenDialog(getMainWindow() ?? undefined, {
      title: "Select app source directory",
      properties: ["openDirectory", "dontAddToRecent"],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });
}

module.exports = {
  registerAppsIpc,
};
