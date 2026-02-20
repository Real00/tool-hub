import type {
  ConfigBackupResult,
  ConfigRestoreResult,
  TabDefinition,
} from "../types/settings";
import type { AppsRootInfo, InstalledApp } from "../types/app";
import type { SystemAppEntry } from "../types/system-app";
import type { UpdateState } from "../types/update";
import type {
  ClaudeCliDetectionResult,
  GeneratorInstallResult,
  GeneratorProjectDetail,
  GeneratorProjectFileContent,
  GeneratorProjectSummary,
  GeneratorSettings,
  GeneratorTerminalState,
} from "../types/generator";

export interface QuickLauncherWindowSizePayload {
  mode: "compact" | "expanded";
  resultCount?: number;
  showEmptyState?: boolean;
  showPayloadHint?: boolean;
}

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
  setQuickLauncherWindowSize: (payload: QuickLauncherWindowSizePayload) => Promise<boolean>;
  getUpdateState: () => Promise<UpdateState>;
  checkForUpdates: () => Promise<UpdateState>;
  downloadUpdate: () => Promise<UpdateState>;
  installUpdateAndRestart: () => Promise<boolean>;
  subscribeUpdateEvents: (callback: (state: UpdateState) => void) => () => void;
  subscribeQuickLauncherRequest: (callback: () => void) => () => void;
}

function getApi(): ToolHubApi {
  const api = window.toolHubApi;
  if (!api) {
    throw new Error("Electron API unavailable in current runtime.");
  }
  return api;
}

export function isElectronRuntime(): boolean {
  return typeof window !== "undefined" && !!window.toolHubApi;
}

export function pingBackend(name: string): Promise<string> {
  return getApi().ping(name);
}

export function getSettingsTabs(): Promise<TabDefinition[]> {
  return getApi().getSettingsTabs();
}

export function saveSettingsTabs(tabs: TabDefinition[]): Promise<TabDefinition[]> {
  return getApi().saveSettingsTabs(tabs);
}

export function initializeSettingsDatabase(): Promise<TabDefinition[]> {
  return getApi().initializeSettingsDatabase();
}

export function backupConfiguration(): Promise<ConfigBackupResult> {
  return getApi().backupConfiguration();
}

export function restoreConfigurationFromArchive(): Promise<ConfigRestoreResult> {
  return getApi().restoreConfigurationFromArchive();
}

export function getGeneratorSettings(): Promise<GeneratorSettings> {
  return getApi().getGeneratorSettings();
}

export function saveGeneratorSettings(input: GeneratorSettings): Promise<GeneratorSettings> {
  return getApi().saveGeneratorSettings(input);
}

export function detectClaudeCli(): Promise<ClaudeCliDetectionResult> {
  return getApi().detectClaudeCli();
}

export function createGeneratorProject(projectName?: string): Promise<GeneratorProjectDetail> {
  return getApi().createGeneratorProject(projectName);
}

export function getGeneratorProject(projectId: string): Promise<GeneratorProjectDetail> {
  return getApi().getGeneratorProject(projectId);
}

export function listGeneratorProjects(): Promise<GeneratorProjectSummary[]> {
  return getApi().listGeneratorProjects();
}

export function readGeneratorProjectFile(
  projectId: string,
  filePath: string,
): Promise<GeneratorProjectFileContent> {
  return getApi().readGeneratorProjectFile(projectId, filePath);
}

export function installGeneratorProjectApp(
  projectId: string,
  tabId: string,
  overwriteExisting = false,
): Promise<GeneratorInstallResult> {
  return getApi().installGeneratorProjectApp(projectId, tabId, overwriteExisting);
}

export function getGeneratorProjectTerminal(projectId: string): Promise<GeneratorTerminalState> {
  return getApi().getGeneratorProjectTerminal(projectId);
}

export function startGeneratorProjectTerminal(projectId: string): Promise<GeneratorTerminalState> {
  return getApi().startGeneratorProjectTerminal(projectId);
}

export function sendGeneratorProjectTerminalInput(
  projectId: string,
  text: string,
  appendNewline = true,
): Promise<GeneratorTerminalState> {
  return getApi().sendGeneratorProjectTerminalInput(projectId, text, appendNewline);
}

export function stopGeneratorProjectTerminal(projectId: string): Promise<GeneratorTerminalState> {
  return getApi().stopGeneratorProjectTerminal(projectId);
}

export function resizeGeneratorProjectTerminal(
  projectId: string,
  cols: number,
  rows: number,
): Promise<GeneratorTerminalState> {
  return getApi().resizeGeneratorProjectTerminal(projectId, cols, rows);
}

export function subscribeGeneratorProjectTerminal(
  projectId: string,
  callback: (state: GeneratorTerminalState) => void,
): () => void {
  return getApi().subscribeGeneratorProjectTerminal(projectId, callback);
}

export function getAppsRoot(): Promise<AppsRootInfo> {
  return getApi().getAppsRoot();
}

export function listApps(): Promise<InstalledApp[]> {
  return getApi().listApps();
}

export function initializeAppsDatabase(): Promise<InstalledApp[]> {
  return getApi().initializeAppsDatabase();
}

export function installAppFromDirectory(
  sourceDir: string,
  tabId?: string,
  overwriteExisting = false,
): Promise<InstalledApp[]> {
  return getApi().installAppFromDirectory(sourceDir, tabId, overwriteExisting);
}

export function startApp(appId: string): Promise<InstalledApp[]> {
  return getApi().startApp(appId);
}

export function stopApp(appId: string): Promise<InstalledApp[]> {
  return getApi().stopApp(appId);
}

export function getAppLogs(appId: string): Promise<string[]> {
  return getApi().getAppLogs(appId);
}

export function removeApp(appId: string): Promise<InstalledApp[]> {
  return getApi().removeApp(appId);
}

export function openAppWindow(appId: string, launchPayload?: string): Promise<boolean> {
  return getApi().openAppWindow(appId, launchPayload);
}

export function pickInstallDirectory(): Promise<string | null> {
  return getApi().pickInstallDirectory();
}

export function refreshSystemAppsIndex(): Promise<number> {
  return getApi().refreshSystemAppsIndex();
}

export function searchSystemApps(query: string, limit = 12): Promise<SystemAppEntry[]> {
  return getApi().searchSystemApps(query, limit);
}

export function openSystemApp(appId: string, launchPayload?: string): Promise<boolean> {
  return getApi().openSystemApp(appId, launchPayload);
}

export function closeQuickLauncherWindow(): Promise<boolean> {
  return getApi().closeQuickLauncherWindow();
}

export function setQuickLauncherWindowSize(
  payload: QuickLauncherWindowSizePayload,
): Promise<boolean> {
  return getApi().setQuickLauncherWindowSize(payload);
}

export function getUpdateState(): Promise<UpdateState> {
  return getApi().getUpdateState();
}

export function checkForUpdates(): Promise<UpdateState> {
  return getApi().checkForUpdates();
}

export function downloadUpdate(): Promise<UpdateState> {
  return getApi().downloadUpdate();
}

export function installUpdateAndRestart(): Promise<boolean> {
  return getApi().installUpdateAndRestart();
}

export function subscribeUpdateEvents(callback: (state: UpdateState) => void): () => void {
  return getApi().subscribeUpdateEvents(callback);
}

export function subscribeQuickLauncherRequest(callback: () => void): () => void {
  return getApi().subscribeQuickLauncherRequest(callback);
}
