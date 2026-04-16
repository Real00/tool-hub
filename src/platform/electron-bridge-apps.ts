import type {
  AppCapabilityDispatchPayload,
  AppCapabilityDispatchResult,
  AppKvListResult,
  AppLaunchContextInput,
  AppLogEvent,
  AppRunRecord,
  AppsRootInfo,
  InstalledApp,
  RemoveAppOptions,
} from "../types/app";
import { getApi } from "./electron-bridge-runtime";

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
