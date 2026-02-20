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
