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

export interface AppRunRecord {
  runId: number;
  appId: string;
  pid: number | null;
  status: string;
  startedAt: number;
  endedAt: number | null;
  exitCode: number | null;
  durationMs: number | null;
}

export interface AppLogEvent {
  appId: string;
  line: string;
  time: number;
  stream: string;
  text: string;
}
