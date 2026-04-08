/// <reference types="vite/client" />

import type {
  AppCapabilityDispatchPayload,
  AppCapabilityDispatchResult,
  AppLaunchContextInput,
  AppLogEvent,
  AppRunRecord,
  AppsRootInfo,
  ContextDispatchRequest,
  InstalledApp,
  RemoveAppOptions,
} from "./types/app";
import type {
  ClaudeCliDetectionResult,
  GeneratorProjectAgentsUpdateResult,
  GeneratorInstallResult,
  GeneratorProjectDetail,
  GeneratorProjectFileContent,
  GeneratorProjectSummary,
  GeneratorSettings,
  GeneratorTerminalState,
  GeneratorValidationResult,
  GeneratorVerifyResult,
} from "./types/generator";
import type {
  ConfigBackupResult,
  ConfigRestoreResult,
  QuickLauncherHotkeyState,
  TabDefinition,
} from "./types/settings";
import type {
  StartSystemRecorderInput,
  SystemAppEntry,
  SystemRecorderStartResult,
  SystemRecorderSource,
  SystemRecorderSourceKind,
  SystemRecorderState,
} from "./types/system-app";
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
    updateGeneratorProjectAgents: (
      projectId: string,
    ) => Promise<GeneratorProjectAgentsUpdateResult>;
    installGeneratorProjectApp: (
      projectId: string,
      tabId: string,
      overwriteExisting?: boolean,
      verifyCommandOverride?: string,
    ) => Promise<GeneratorInstallResult>;
    validateGeneratorProject: (
      projectId: string,
      tabId?: string,
    ) => Promise<GeneratorValidationResult>;
    runGeneratorProjectVerify: (
      projectId: string,
      commandOverride?: string,
    ) => Promise<GeneratorVerifyResult>;
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
    batchStopApps: (appIds: string[]) => Promise<InstalledApp[]>;
    getAppLogs: (appId: string) => Promise<string[]>;
    getAppRuns: (appId: string, limit?: number) => Promise<AppRunRecord[]>;
    updateAppTab: (appId: string, tabId: string) => Promise<InstalledApp[]>;
    setAppAutoStart: (appId: string, enabled: boolean) => Promise<InstalledApp[]>;
    listAppKv: (appId: string) => Promise<{ appId: string; entries: Array<{ key: string; value: unknown; updatedAt: number }> }>;
    deleteAppKvEntry: (appId: string, key: string) => Promise<void>;
    clearAppKv: (appId: string) => Promise<void>;
    batchRemoveApps: (
      appIds: string[],
      options?: RemoveAppOptions,
    ) => Promise<InstalledApp[]>;
    subscribeAppLogs: (
      appId: string,
      callback: (event: AppLogEvent) => void,
    ) => () => void;
    removeApp: (appId: string, options?: RemoveAppOptions) => Promise<InstalledApp[]>;
    openAppWindow: (appId: string, launchContext?: AppLaunchContextInput) => Promise<boolean>;
    dispatchAppCapability: (
      payload: AppCapabilityDispatchPayload,
    ) => Promise<AppCapabilityDispatchResult>;
    pickInstallDirectory: () => Promise<string | null>;
    refreshSystemAppsIndex: () => Promise<number>;
    searchSystemApps: (query: string, limit?: number) => Promise<SystemAppEntry[]>;
    getSystemAppsByIds: (appIds: string[]) => Promise<SystemAppEntry[]>;
    openSystemApp: (appId: string, launchPayload?: string) => Promise<boolean>;
    getSystemRecorderState: () => Promise<SystemRecorderState>;
    listSystemRecorderSources: (mode: SystemRecorderSourceKind) => Promise<SystemRecorderSource[]>;
    prepareSystemRecorderPreview: (input: {
      mode: SystemRecorderSourceKind;
      sourceId: string;
    }) => Promise<boolean>;
    startSystemRecorder: (input: StartSystemRecorderInput) => Promise<SystemRecorderStartResult>;
    appendSystemRecorderChunk: (sessionId: string, chunk: Uint8Array) => Promise<void>;
    finishSystemRecorder: (sessionId: string) => Promise<SystemRecorderState>;
    abortSystemRecorder: (sessionId: string, errorMessage?: string) => Promise<SystemRecorderState>;
    pickSystemRecorderFfmpegPath: () => Promise<{
      canceled: boolean;
      filePath: string;
      state: SystemRecorderState;
    }>;
    setSystemRecorderFfmpegPath: (filePath: string) => Promise<SystemRecorderState>;
    closeQuickLauncherWindow: () => Promise<boolean>;
    getQuickLauncherHotkeyState: () => Promise<QuickLauncherHotkeyState>;
    saveQuickLauncherHotkey: (accelerator: string) => Promise<QuickLauncherHotkeyState>;
    applyQuickLauncherHotkey: (accelerator?: string) => Promise<QuickLauncherHotkeyState>;
    retryQuickLauncherHotkey: () => Promise<QuickLauncherHotkeyState>;
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
    subscribeContextDispatchRequest: (
      callback: (payload: ContextDispatchRequest) => void,
    ) => () => void;
  }

  interface Window {
    toolHubApi?: ToolHubApi;
  }
}

export {};
