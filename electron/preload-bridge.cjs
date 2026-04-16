const { contextBridge, ipcRenderer } = require("electron");
const { createCoreApi } = require("./preload/core-api.cjs");
const { createSettingsApi } = require("./preload/settings-api.cjs");
const { createGeneratorApi } = require("./preload/generator-api.cjs");
const { createAppsApi } = require("./preload/apps-api.cjs");
const { createSystemApi } = require("./preload/system-api.cjs");
const { createQuickLauncherApi } = require("./preload/quick-launcher-api.cjs");
const { createAiChatApi } = require("./preload/ai-chat-api.cjs");
const { createDeveloperToolsApi } = require("./preload/developer-tools-api.cjs");
const { createUpdateApi } = require("./preload/update-api.cjs");
contextBridge.exposeInMainWorld("toolHubApi", {
  ...createCoreApi(ipcRenderer),
  ...createSettingsApi(ipcRenderer),
  ...createGeneratorApi(ipcRenderer),
  ...createAppsApi(ipcRenderer),
  ...createSystemApi(ipcRenderer),
  ...createQuickLauncherApi(ipcRenderer),
  ...createAiChatApi(ipcRenderer),
  ...createDeveloperToolsApi(ipcRenderer),
  ...createUpdateApi(ipcRenderer),
});
