function registerGeneratorIpc(options = {}) {
  const ipcMain = options.ipcMain;
  const getAppGenerator = options.getAppGenerator;
  const getAppsManager = options.getAppsManager;
  const getSettingsStore = options.getSettingsStore;

  const terminalSubscriptions = new Map();

  function makeTerminalSubscriptionKey(webContentsId, projectId) {
    return `${webContentsId}:${projectId}`;
  }

  function removeTerminalSubscription(webContentsId, projectId) {
    const key = makeTerminalSubscriptionKey(webContentsId, projectId);
    const unsubscribe = terminalSubscriptions.get(key);
    if (!unsubscribe) {
      return;
    }
    terminalSubscriptions.delete(key);
    try {
      unsubscribe();
    } catch {
      // Ignore cleanup errors.
    }
  }

  function removeAllTerminalSubscriptionsForWebContents(webContentsId) {
    const prefix = `${webContentsId}:`;
    Array.from(terminalSubscriptions.keys())
      .filter((key) => key.startsWith(prefix))
      .forEach((key) => {
        const unsubscribe = terminalSubscriptions.get(key);
        terminalSubscriptions.delete(key);
        try {
          unsubscribe?.();
        } catch {
          // Ignore cleanup errors.
        }
      });
  }

  ipcMain.handle("generator:get-settings", async () => {
    return getAppGenerator().getGeneratorSettings(getSettingsStore());
  });

  ipcMain.handle("generator:save-settings", async (_event, input) => {
    return getAppGenerator().saveGeneratorSettings(getSettingsStore(), input);
  });

  ipcMain.handle("generator:detect-claude-cli", async () => {
    return getAppGenerator().detectClaudeCli(getSettingsStore());
  });

  ipcMain.handle("generator:create-project", async (_event, projectName) => {
    return getAppGenerator().createProject(projectName);
  });

  ipcMain.handle("generator:get-project", async (_event, projectId) => {
    return getAppGenerator().getProject(projectId);
  });

  ipcMain.handle("generator:list-projects", async () => {
    return getAppGenerator().listProjects();
  });

  ipcMain.handle(
    "generator:read-project-file",
    async (_event, projectId, filePath) => {
      return getAppGenerator().readProjectFile(projectId, filePath);
    },
  );

  ipcMain.handle("generator:update-project-agents", async (_event, projectId) => {
    return getAppGenerator().updateProjectAgentsRules(projectId);
  });

  ipcMain.handle(
    "generator:install-project",
    async (_event, projectId, tabId, overwriteExisting, verifyCommandOverride) => {
      return getAppGenerator().installProjectApp(
        getAppsManager(),
        getSettingsStore(),
        projectId,
        tabId,
        overwriteExisting,
        verifyCommandOverride,
      );
    },
  );

  ipcMain.handle("generator:validate-project", async (_event, projectId, tabId) => {
    return getAppGenerator().validateProject(projectId, tabId);
  });

  ipcMain.handle("generator:run-verify", async (_event, projectId, commandOverride) => {
    return getAppGenerator().runProjectVerify(
      projectId,
      getSettingsStore(),
      commandOverride,
    );
  });

  ipcMain.handle("generator:get-terminal", async (_event, projectId) => {
    return getAppGenerator().getProjectTerminal(projectId);
  });

  ipcMain.handle("generator:start-terminal", async (_event, projectId) => {
    return getAppGenerator().startProjectTerminal(projectId);
  });

  ipcMain.handle(
    "generator:terminal-input",
    async (_event, projectId, text, appendNewline) => {
      return getAppGenerator().sendProjectTerminalInput(
        projectId,
        text,
        appendNewline,
      );
    },
  );

  ipcMain.handle("generator:stop-terminal", async (_event, projectId) => {
    return getAppGenerator().stopProjectTerminal(projectId);
  });

  ipcMain.handle(
    "generator:resize-terminal",
    async (_event, projectId, cols, rows) => {
      return getAppGenerator().resizeProjectTerminal(projectId, cols, rows);
    },
  );

  ipcMain.on("generator:terminal-subscribe", (event, projectId) => {
    const webContents = event.sender;
    const webContentsId = webContents.id;
    const key = makeTerminalSubscriptionKey(webContentsId, projectId);
    removeTerminalSubscription(webContentsId, projectId);

    const unsubscribe = getAppGenerator().subscribeProjectTerminal(
      projectId,
      (payload) => {
        if (webContents.isDestroyed()) {
          removeTerminalSubscription(webContentsId, projectId);
          return;
        }
        webContents.send("generator:terminal-output", payload);
      },
    );
    terminalSubscriptions.set(key, unsubscribe);

    webContents.once("destroyed", () => {
      removeAllTerminalSubscriptionsForWebContents(webContentsId);
    });
  });

  ipcMain.on("generator:terminal-unsubscribe", (event, projectId) => {
    removeTerminalSubscription(event.sender.id, projectId);
  });
}

module.exports = {
  registerGeneratorIpc,
};
