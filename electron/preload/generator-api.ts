// @ts-nocheck
const { createFilteredSubscription } = require("./api-utils");

function createGeneratorApi(ipcRenderer) {
  return {
    getGeneratorSettings() {
      return ipcRenderer.invoke("generator:get-settings");
    },
    saveGeneratorSettings(input) {
      return ipcRenderer.invoke("generator:save-settings", input);
    },
    detectClaudeCli() {
      return ipcRenderer.invoke("generator:detect-claude-cli");
    },
    createGeneratorProject(projectName) {
      return ipcRenderer.invoke("generator:create-project", projectName);
    },
    getGeneratorProject(projectId) {
      return ipcRenderer.invoke("generator:get-project", projectId);
    },
    listGeneratorProjects() {
      return ipcRenderer.invoke("generator:list-projects");
    },
    readGeneratorProjectFile(projectId, filePath) {
      return ipcRenderer.invoke("generator:read-project-file", projectId, filePath);
    },
    updateGeneratorProjectAgents(projectId) {
      return ipcRenderer.invoke("generator:update-project-agents", projectId);
    },
    installGeneratorProjectApp(projectId, tabId, overwriteExisting, verifyCommandOverride) {
      return ipcRenderer.invoke(
        "generator:install-project",
        projectId,
        tabId,
        overwriteExisting,
        verifyCommandOverride,
      );
    },
    validateGeneratorProject(projectId, tabId) {
      return ipcRenderer.invoke("generator:validate-project", projectId, tabId);
    },
    runGeneratorProjectVerify(projectId, commandOverride) {
      return ipcRenderer.invoke("generator:run-verify", projectId, commandOverride);
    },
    getGeneratorProjectTerminal(projectId) {
      return ipcRenderer.invoke("generator:get-terminal", projectId);
    },
    startGeneratorProjectTerminal(projectId) {
      return ipcRenderer.invoke("generator:start-terminal", projectId);
    },
    sendGeneratorProjectTerminalInput(projectId, text, appendNewline) {
      return ipcRenderer.invoke("generator:terminal-input", projectId, text, appendNewline);
    },
    stopGeneratorProjectTerminal(projectId) {
      return ipcRenderer.invoke("generator:stop-terminal", projectId);
    },
    resizeGeneratorProjectTerminal(projectId, cols, rows) {
      return ipcRenderer.invoke("generator:resize-terminal", projectId, cols, rows);
    },
    subscribeGeneratorProjectTerminal(projectId, callback) {
      return createFilteredSubscription(
        ipcRenderer,
        "generator:terminal-output",
        (payload) => payload?.projectId === projectId,
        callback,
        {
          subscribeChannel: "generator:terminal-subscribe",
          unsubscribeChannel: "generator:terminal-unsubscribe",
          subscribeArg: projectId,
        },
      );
    },
  };
}

module.exports = {
  createGeneratorApi,
};
