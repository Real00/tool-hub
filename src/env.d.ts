/// <reference types="vite/client" />

interface TabDefinition {
  id: string;
  label: string;
}

interface InstalledApp {
  id: string;
  name: string;
  version: string;
  tabId: string;
  appDir: string;
  entryRel: string;
  uiUrl: string | null;
  running: boolean;
  pid: number | null;
}

interface AppsRootInfo {
  appsRoot: string;
  dbPath: string;
}

interface ToolHubApi {
  ping: (name: string) => Promise<string>;
  getSettingsTabs: () => Promise<TabDefinition[]>;
  saveSettingsTabs: (tabs: TabDefinition[]) => Promise<TabDefinition[]>;
  initializeSettingsDatabase: () => Promise<TabDefinition[]>;
  getAppsRoot: () => Promise<AppsRootInfo>;
  listApps: () => Promise<InstalledApp[]>;
  initializeAppsDatabase: () => Promise<InstalledApp[]>;
  installAppFromDirectory: (sourceDir: string, tabId?: string) => Promise<InstalledApp[]>;
  startApp: (appId: string) => Promise<InstalledApp[]>;
  stopApp: (appId: string) => Promise<InstalledApp[]>;
  getAppLogs: (appId: string) => Promise<string[]>;
  removeApp: (appId: string) => Promise<InstalledApp[]>;
  openAppWindow: (appId: string) => Promise<boolean>;
  pickInstallDirectory: () => Promise<string | null>;
}

interface Window {
  toolHubApi?: ToolHubApi;
}
