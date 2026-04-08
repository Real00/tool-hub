export interface TabDefinition {
  id: string;
  label: string;
}

export interface ConfigBackupResult {
  canceled: boolean;
  archivePath: string | null;
  includedPaths: string[];
}

export interface ConfigRestoreResult {
  canceled: boolean;
  restored: boolean;
  archivePath: string | null;
  restoredPaths: string[];
  restartRecommended: boolean;
}

export type QuickLauncherHotkeyError = "occupied" | "invalid" | "unknown" | null;

export interface QuickLauncherHotkeyState {
  configuredAccelerator: string;
  activeAccelerator: string | null;
  registered: boolean;
  lastError: QuickLauncherHotkeyError;
  updatedAt: number;
}
