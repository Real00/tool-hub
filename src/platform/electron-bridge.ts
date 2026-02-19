import type { TabDefinition } from "../types/settings";
import type { AppsRootInfo, InstalledApp } from "../types/app";

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

export function getAppsRoot(): Promise<AppsRootInfo> {
  return getApi().getAppsRoot();
}

export function listApps(): Promise<InstalledApp[]> {
  return getApi().listApps();
}

export function initializeAppsDatabase(): Promise<InstalledApp[]> {
  return getApi().initializeAppsDatabase();
}

export function installAppFromDirectory(sourceDir: string, tabId?: string): Promise<InstalledApp[]> {
  return getApi().installAppFromDirectory(sourceDir, tabId);
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

export function openAppWindow(appId: string): Promise<boolean> {
  return getApi().openAppWindow(appId);
}

export function pickInstallDirectory(): Promise<string | null> {
  return getApi().pickInstallDirectory();
}
