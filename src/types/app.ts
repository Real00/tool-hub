export interface InstalledApp {
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

export interface AppsRootInfo {
  appsRoot: string;
  dbPath: string;
}
