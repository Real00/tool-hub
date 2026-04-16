import type {
  ConfigBackupResult,
  ConfigRestoreResult,
  TabDefinition,
} from "../types/settings";
import { getApi } from "./electron-bridge-runtime";

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
