/// <reference types="vite/client" />

import type { AppsRootInfo, InstalledApp } from "./types/app";
import type {
  ClaudeCliDetectionResult,
  GeneratorChatResult,
  GeneratorInstallResult,
  GeneratorProjectDetail,
  GeneratorProjectFileContent,
  GeneratorProjectSummary,
  GeneratorSettings,
  GeneratorTerminalState,
} from "./types/generator";
import type { TabDefinition } from "./types/settings";
import type { SystemAppEntry } from "./types/system-app";

declare global {
  interface ToolHubApi {
    ping: (name: string) => Promise<string>;
    getSettingsTabs: () => Promise<TabDefinition[]>;
    saveSettingsTabs: (tabs: TabDefinition[]) => Promise<TabDefinition[]>;
    initializeSettingsDatabase: () => Promise<TabDefinition[]>;
    getGeneratorSettings: () => Promise<GeneratorSettings>;
    saveGeneratorSettings: (input: GeneratorSettings) => Promise<GeneratorSettings>;
    detectClaudeCli: () => Promise<ClaudeCliDetectionResult>;
    createGeneratorProject: (projectName?: string) => Promise<GeneratorProjectDetail>;
    getGeneratorProject: (projectId: string) => Promise<GeneratorProjectDetail>;
    listGeneratorProjects: () => Promise<GeneratorProjectSummary[]>;
    readGeneratorProjectFile: (
      projectId: string,
      filePath: string,
    ) => Promise<GeneratorProjectFileContent>;
    generatorChatInProject: (
      projectId: string,
      message: string,
      cliPathOverride?: string,
    ) => Promise<GeneratorChatResult>;
    installGeneratorProjectApp: (
      projectId: string,
      tabId: string,
      overwriteExisting?: boolean,
    ) => Promise<GeneratorInstallResult>;
    getGeneratorProjectTerminal: (projectId: string) => Promise<GeneratorTerminalState>;
    startGeneratorProjectTerminal: (projectId: string) => Promise<GeneratorTerminalState>;
    sendGeneratorProjectTerminalInput: (
      projectId: string,
      text: string,
      appendNewline?: boolean,
    ) => Promise<GeneratorTerminalState>;
    stopGeneratorProjectTerminal: (projectId: string) => Promise<GeneratorTerminalState>;
    resizeGeneratorProjectTerminal: (
      projectId: string,
      cols: number,
      rows: number,
    ) => Promise<GeneratorTerminalState>;
    subscribeGeneratorProjectTerminal: (
      projectId: string,
      callback: (state: GeneratorTerminalState) => void,
    ) => () => void;
    getAppsRoot: () => Promise<AppsRootInfo>;
    listApps: () => Promise<InstalledApp[]>;
    initializeAppsDatabase: () => Promise<InstalledApp[]>;
    installAppFromDirectory: (
      sourceDir: string,
      tabId?: string,
      overwriteExisting?: boolean,
    ) => Promise<InstalledApp[]>;
    startApp: (appId: string) => Promise<InstalledApp[]>;
    stopApp: (appId: string) => Promise<InstalledApp[]>;
    getAppLogs: (appId: string) => Promise<string[]>;
    removeApp: (appId: string) => Promise<InstalledApp[]>;
    openAppWindow: (appId: string, launchPayload?: string) => Promise<boolean>;
    pickInstallDirectory: () => Promise<string | null>;
    refreshSystemAppsIndex: () => Promise<number>;
    searchSystemApps: (query: string, limit?: number) => Promise<SystemAppEntry[]>;
    openSystemApp: (appId: string, launchPayload?: string) => Promise<boolean>;
    subscribeQuickLauncherRequest: (callback: () => void) => () => void;
  }

  interface Window {
    toolHubApi?: ToolHubApi;
  }
}

export {};
