import type {
  ConfigBackupResult,
  ConfigRestoreResult,
  QuickLauncherHotkeyState,
  TabDefinition,
} from "../types/settings";
import type {
  AppCapabilityDispatchPayload,
  AppCapabilityDispatchResult,
  AppKvListResult,
  AppLaunchContextInput,
  AppLogEvent,
  AppRunRecord,
  AppsRootInfo,
  ClipboardPathContext,
  ContextDispatchRequest,
  InstalledApp,
  RemoveAppOptions,
} from "../types/app";
import type {
  StartSystemRecorderInput,
  SystemAppEntry,
  SystemRecorderStartResult,
  SystemRecorderSource,
  SystemRecorderSourceKind,
  SystemRecorderState,
} from "../types/system-app";
import type { UpdateState } from "../types/update";
import type {
  AiChatLaunchState,
  AiChatMessage,
  AiChatModelOption,
  AiChatSessionSummary,
  AiChatSettings,
  AiChatStreamEvent,
  SendAiChatMessageInput,
  SendAiChatMessageResult,
} from "../types/ai-chat";
import type {
  DeveloperToolsAnalyzeResult,
  DeveloperToolsLaunchState,
  DeveloperToolsTransformId,
  DeveloperToolsTransformResult,
  QuickLauncherClipboardDeveloperToolsContext,
} from "../types/developer-tools";
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
  updateGeneratorProjectAgents: (projectId: string) => Promise<GeneratorProjectAgentsUpdateResult>;
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
  listAppKv: (appId: string) => Promise<AppKvListResult>;
  deleteAppKvEntry: (appId: string, key: string) => Promise<void>;
  clearAppKv: (appId: string) => Promise<void>;
  batchRemoveApps: (appIds: string[], options?: RemoveAppOptions) => Promise<InstalledApp[]>;
  subscribeAppLogs: (appId: string, callback: (event: AppLogEvent) => void) => () => void;
  removeApp: (appId: string, options?: RemoveAppOptions) => Promise<InstalledApp[]>;
  openAppWindow: (appId: string, launchContext?: AppLaunchContextInput) => Promise<boolean>;
  dispatchAppCapability: (
    payload: AppCapabilityDispatchPayload,
  ) => Promise<AppCapabilityDispatchResult>;
  pickInstallDirectory: () => Promise<string | null>;
  refreshSystemAppsIndex: () => Promise<number>;
  listSystemApps: () => Promise<SystemAppEntry[]>;
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
  getQuickLauncherClipboardPathContext: () => Promise<ClipboardPathContext | null>;
  getQuickLauncherClipboardDeveloperToolsContext: () => Promise<QuickLauncherClipboardDeveloperToolsContext | null>;
  openClipboardPathFile: (path: string) => Promise<boolean>;
  openClipboardPathLocation: (path: string) => Promise<boolean>;
  setQuickLauncherWindowSize: (payload: QuickLauncherWindowSizePayload) => Promise<boolean>;
  getAiChatSettings: () => Promise<AiChatSettings>;
  saveAiChatSettings: (input: AiChatSettings) => Promise<AiChatSettings>;
  listAiChatModels: (input: Pick<AiChatSettings, "provider" | "baseUrl" | "apiKey">) => Promise<AiChatModelOption[]>;
  listAiChatSessions: () => Promise<AiChatSessionSummary[]>;
  createAiChatSession: () => Promise<AiChatSessionSummary>;
  deleteAiChatSession: (sessionId: string) => Promise<boolean>;
  getAiChatSessionMessages: (sessionId: string) => Promise<AiChatMessage[]>;
  sendAiChatMessage: (input: SendAiChatMessageInput) => Promise<SendAiChatMessageResult>;
  beginAiChatStream: (requestId: string) => Promise<boolean>;
  cancelAiChatStream: (requestId: string) => Promise<boolean>;
  getAiChatLaunchState: () => Promise<AiChatLaunchState>;
  analyzeDeveloperToolsText: (text: string) => Promise<DeveloperToolsAnalyzeResult>;
  runDeveloperToolsTransform: (
    text: string,
    transformId: DeveloperToolsTransformId,
  ) => Promise<DeveloperToolsTransformResult>;
  getDeveloperToolsLaunchState: () => Promise<DeveloperToolsLaunchState>;
  subscribeAiChatStream: (callback: (event: AiChatStreamEvent) => void) => () => void;
  subscribeAiChatLaunch: (callback: (state: AiChatLaunchState) => void) => () => void;
  subscribeDeveloperToolsLaunch: (
    callback: (state: DeveloperToolsLaunchState) => void,
  ) => () => void;
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

export function updateGeneratorProjectAgents(
  projectId: string,
): Promise<GeneratorProjectAgentsUpdateResult> {
  return getApi().updateGeneratorProjectAgents(projectId);
}

export function installGeneratorProjectApp(
  projectId: string,
  tabId: string,
  overwriteExisting = false,
  verifyCommandOverride = "",
): Promise<GeneratorInstallResult> {
  return getApi().installGeneratorProjectApp(
    projectId,
    tabId,
    overwriteExisting,
    verifyCommandOverride,
  );
}

export function validateGeneratorProject(
  projectId: string,
  tabId?: string,
): Promise<GeneratorValidationResult> {
  return getApi().validateGeneratorProject(projectId, tabId);
}

export function runGeneratorProjectVerify(
  projectId: string,
  commandOverride?: string,
): Promise<GeneratorVerifyResult> {
  return getApi().runGeneratorProjectVerify(projectId, commandOverride);
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

export function batchStopApps(appIds: string[]): Promise<InstalledApp[]> {
  return getApi().batchStopApps(appIds);
}

export function getAppLogs(appId: string): Promise<string[]> {
  return getApi().getAppLogs(appId);
}

export function getAppRuns(appId: string, limit = 30): Promise<AppRunRecord[]> {
  return getApi().getAppRuns(appId, limit);
}

export function updateAppTab(appId: string, tabId: string): Promise<InstalledApp[]> {
  return getApi().updateAppTab(appId, tabId);
}

export function setAppAutoStart(appId: string, enabled: boolean): Promise<InstalledApp[]> {
  return getApi().setAppAutoStart(appId, enabled);
}

export function listAppKv(appId: string): Promise<AppKvListResult> {
  return getApi().listAppKv(appId);
}

export function deleteAppKvEntry(appId: string, key: string): Promise<void> {
  return getApi().deleteAppKvEntry(appId, key);
}

export function clearAppKv(appId: string): Promise<void> {
  return getApi().clearAppKv(appId);
}

export function batchRemoveApps(
  appIds: string[],
  options?: RemoveAppOptions,
): Promise<InstalledApp[]> {
  return getApi().batchRemoveApps(appIds, options);
}

export function subscribeAppLogs(
  appId: string,
  callback: (event: AppLogEvent) => void,
): () => void {
  return getApi().subscribeAppLogs(appId, callback);
}

export function removeApp(appId: string, options?: RemoveAppOptions): Promise<InstalledApp[]> {
  return getApi().removeApp(appId, options);
}

export function openAppWindow(
  appId: string,
  launchContext?: AppLaunchContextInput,
): Promise<boolean> {
  return getApi().openAppWindow(appId, launchContext);
}

export function dispatchAppCapability(
  payload: AppCapabilityDispatchPayload,
): Promise<AppCapabilityDispatchResult> {
  return getApi().dispatchAppCapability(payload);
}

export function pickInstallDirectory(): Promise<string | null> {
  return getApi().pickInstallDirectory();
}

export function refreshSystemAppsIndex(): Promise<number> {
  return getApi().refreshSystemAppsIndex();
}

export function listSystemApps(): Promise<SystemAppEntry[]> {
  return getApi().listSystemApps();
}

export function searchSystemApps(query: string, limit = 12): Promise<SystemAppEntry[]> {
  return getApi().searchSystemApps(query, limit);
}

export function getSystemAppsByIds(appIds: string[]): Promise<SystemAppEntry[]> {
  return getApi().getSystemAppsByIds(appIds);
}

export function openSystemApp(appId: string, launchPayload?: string): Promise<boolean> {
  return getApi().openSystemApp(appId, launchPayload);
}

export function getSystemRecorderState(): Promise<SystemRecorderState> {
  return getApi().getSystemRecorderState();
}

export function listSystemRecorderSources(
  mode: SystemRecorderSourceKind,
): Promise<SystemRecorderSource[]> {
  return getApi().listSystemRecorderSources(mode);
}

export function prepareSystemRecorderPreview(input: {
  mode: SystemRecorderSourceKind;
  sourceId: string;
}): Promise<boolean> {
  return getApi().prepareSystemRecorderPreview(input);
}

export function startSystemRecorder(
  input: StartSystemRecorderInput,
): Promise<SystemRecorderStartResult> {
  return getApi().startSystemRecorder(input);
}

export function appendSystemRecorderChunk(
  sessionId: string,
  chunk: Uint8Array,
): Promise<void> {
  return getApi().appendSystemRecorderChunk(sessionId, chunk);
}

export function finishSystemRecorder(sessionId: string): Promise<SystemRecorderState> {
  return getApi().finishSystemRecorder(sessionId);
}

export function abortSystemRecorder(
  sessionId: string,
  errorMessage = "",
): Promise<SystemRecorderState> {
  return getApi().abortSystemRecorder(sessionId, errorMessage);
}

export function pickSystemRecorderFfmpegPath(): Promise<{
  canceled: boolean;
  filePath: string;
  state: SystemRecorderState;
}> {
  return getApi().pickSystemRecorderFfmpegPath();
}

export function setSystemRecorderFfmpegPath(filePath: string): Promise<SystemRecorderState> {
  return getApi().setSystemRecorderFfmpegPath(filePath);
}

export function closeQuickLauncherWindow(): Promise<boolean> {
  return getApi().closeQuickLauncherWindow();
}

export function getQuickLauncherHotkeyState(): Promise<QuickLauncherHotkeyState> {
  return getApi().getQuickLauncherHotkeyState();
}

export function saveQuickLauncherHotkey(
  accelerator: string,
): Promise<QuickLauncherHotkeyState> {
  return getApi().saveQuickLauncherHotkey(accelerator);
}

export function applyQuickLauncherHotkey(
  accelerator?: string,
): Promise<QuickLauncherHotkeyState> {
  return getApi().applyQuickLauncherHotkey(accelerator);
}

export function retryQuickLauncherHotkey(): Promise<QuickLauncherHotkeyState> {
  return getApi().retryQuickLauncherHotkey();
}

export function getQuickLauncherClipboardPathContext(): Promise<ClipboardPathContext | null> {
  return getApi().getQuickLauncherClipboardPathContext();
}

export function getQuickLauncherClipboardDeveloperToolsContext(): Promise<QuickLauncherClipboardDeveloperToolsContext | null> {
  return getApi().getQuickLauncherClipboardDeveloperToolsContext();
}

export function openClipboardPathFile(path: string): Promise<boolean> {
  return getApi().openClipboardPathFile(path);
}

export function openClipboardPathLocation(path: string): Promise<boolean> {
  return getApi().openClipboardPathLocation(path);
}

export function setQuickLauncherWindowSize(
  payload: QuickLauncherWindowSizePayload,
): Promise<boolean> {
  return getApi().setQuickLauncherWindowSize(payload);
}

export function getAiChatSettings(): Promise<AiChatSettings> {
  return getApi().getAiChatSettings();
}

export function saveAiChatSettings(input: AiChatSettings): Promise<AiChatSettings> {
  return getApi().saveAiChatSettings(input);
}

export function listAiChatModels(
  input: Pick<AiChatSettings, "provider" | "baseUrl" | "apiKey">,
): Promise<AiChatModelOption[]> {
  return getApi().listAiChatModels(input);
}

export function listAiChatSessions(): Promise<AiChatSessionSummary[]> {
  return getApi().listAiChatSessions();
}

export function createAiChatSession(): Promise<AiChatSessionSummary> {
  return getApi().createAiChatSession();
}

export function deleteAiChatSession(sessionId: string): Promise<boolean> {
  return getApi().deleteAiChatSession(sessionId);
}

export function getAiChatSessionMessages(sessionId: string): Promise<AiChatMessage[]> {
  return getApi().getAiChatSessionMessages(sessionId);
}

export function sendAiChatMessage(
  input: SendAiChatMessageInput,
): Promise<SendAiChatMessageResult> {
  return getApi().sendAiChatMessage(input);
}

export function beginAiChatStream(requestId: string): Promise<boolean> {
  return getApi().beginAiChatStream(requestId);
}

export function cancelAiChatStream(requestId: string): Promise<boolean> {
  return getApi().cancelAiChatStream(requestId);
}

export function getAiChatLaunchState(): Promise<AiChatLaunchState> {
  return getApi().getAiChatLaunchState();
}

export function analyzeDeveloperToolsText(
  text: string,
): Promise<DeveloperToolsAnalyzeResult> {
  return getApi().analyzeDeveloperToolsText(text);
}

export function runDeveloperToolsTransform(
  text: string,
  transformId: DeveloperToolsTransformId,
): Promise<DeveloperToolsTransformResult> {
  return getApi().runDeveloperToolsTransform(text, transformId);
}

export function getDeveloperToolsLaunchState(): Promise<DeveloperToolsLaunchState> {
  return getApi().getDeveloperToolsLaunchState();
}

export function subscribeAiChatStream(
  callback: (event: AiChatStreamEvent) => void,
): () => void {
  return getApi().subscribeAiChatStream(callback);
}

export function subscribeAiChatLaunch(
  callback: (state: AiChatLaunchState) => void,
): () => void {
  return getApi().subscribeAiChatLaunch(callback);
}

export function subscribeDeveloperToolsLaunch(
  callback: (state: DeveloperToolsLaunchState) => void,
): () => void {
  return getApi().subscribeDeveloperToolsLaunch(callback);
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

export function subscribeContextDispatchRequest(
  callback: (payload: ContextDispatchRequest) => void,
): () => void {
  return getApi().subscribeContextDispatchRequest(callback);
}
