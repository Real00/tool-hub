/// <reference types="vite/client" />

import type { AppsRootInfo, InstalledApp } from "./types/app";
import type {
  ClaudeCliDetectionResult,
  GeneratorInstallResult,
  GeneratorProjectDetail,
  GeneratorProjectFileContent,
  GeneratorProjectSummary,
  GeneratorSettings,
  GeneratorTerminalState,
} from "./types/generator";
import type {
  ConfigBackupResult,
  ConfigRestoreResult,
  TabDefinition,
} from "./types/settings";
import type { SystemAppEntry } from "./types/system-app";
import type { UpdateState } from "./types/update";

declare global {
  interface ToolHubApi {
    ping: (name: string) => Promise<string>;
    getSettingsTabs: () => Promise<TabDefinition[]>;
    saveSettingsTabs: (tabs: TabDefinition[]) => Promise<TabDefinition[]>;
    initializeSettingsDatabase: () => Promise<TabDefinition[]>;
    backupConfiguration: () => Promise<ConfigBackupResult>;
    restoreConfigurationFromArchive: () => Promise<ConfigRestoreResult>;
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
    closeQuickLauncherWindow: () => Promise<boolean>;
    setQuickLauncherWindowSize: (payload: {
      mode: "compact" | "expanded";
      resultCount?: number;
      showEmptyState?: boolean;
      showPayloadHint?: boolean;
      contentHeight?: number;
    }) => Promise<boolean>;
    getUpdateState: () => Promise<UpdateState>;
    checkForUpdates: () => Promise<UpdateState>;
    downloadUpdate: () => Promise<UpdateState>;
    installUpdateAndRestart: () => Promise<boolean>;
    subscribeUpdateEvents: (callback: (state: UpdateState) => void) => () => void;
    subscribeQuickLauncherRequest: (callback: () => void) => () => void;
  }

  interface Window {
    toolHubApi?: ToolHubApi;
  }
}

export {};
