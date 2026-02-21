export type AppCapabilityTargetKind = "file" | "folder" | "any";
export type DispatchTargetKind = "file" | "folder" | "unknown";
export type AppLaunchSource = "explorer-context-menu" | "quick-launcher" | "manual";

export interface AppCapability {
  id: string;
  name: string;
  description: string | null;
  targets: AppCapabilityTargetKind[];
}

export interface DispatchTarget {
  path: string;
  kind: DispatchTargetKind;
}

export interface AppLaunchContextCapability {
  id: string;
  name: string;
  targets: AppCapabilityTargetKind[];
}

export interface AppLaunchContext {
  source: AppLaunchSource;
  requestId: string;
  requestedAt: number;
  payload?: string;
  capability?: AppLaunchContextCapability;
  targets?: DispatchTarget[];
}

export interface AppLaunchContextInput {
  source?: AppLaunchSource;
  requestId?: string;
  requestedAt?: number;
  payload?: string;
  capability?: {
    id?: string;
    name?: string;
    targets?: AppCapabilityTargetKind[];
  };
  targets?: DispatchTarget[];
}

export interface ContextDispatchRequest {
  requestId: string;
  requestedAt: number;
  source: string;
  targets: DispatchTarget[];
}

export interface AppCapabilityDispatchPayload {
  appId: string;
  capabilityId: string;
  targets: DispatchTarget[];
  requestId?: string;
  requestedAt?: number;
  source?: string;
}

export interface AppCapabilityDispatchResult {
  ok: boolean;
  appId: string;
  capabilityId: string;
  requestId: string;
  targetCount: number;
}

export interface InstalledApp {
  id: string;
  name: string;
  version: string;
  tabId: string;
  appDir: string;
  entryRel: string;
  uiUrl: string | null;
  capabilities: AppCapability[];
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
