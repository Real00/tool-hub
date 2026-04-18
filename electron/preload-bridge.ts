// @ts-nocheck
const { contextBridge, ipcRenderer } = require("electron");
const { createCoreApi } = require("./preload/core-api");
const { createSettingsApi } = require("./preload/settings-api");
const { createGeneratorApi } = require("./preload/generator-api");
const { createAppsApi } = require("./preload/apps-api");
const { createSystemApi } = require("./preload/system-api");
const { createQuickLauncherApi } = require("./preload/quick-launcher-api");
const { createAiChatApi } = require("./preload/ai-chat-api");
const { createDeveloperToolsApi } = require("./preload/developer-tools-api");
const { createUpdateApi } = require("./preload/update-api");
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
