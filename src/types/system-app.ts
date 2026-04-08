export type SystemAppLaunchType = "path" | "uwp" | "command" | "internal";
export type SystemAppCategory = "tool" | "recorder" | "launcher";
export type SystemRecorderSourceKind = "screen" | "window";

export interface SystemAppEntry {
  id: string;
  name: string;
  source: string;
  launchType: SystemAppLaunchType;
  category?: SystemAppCategory;
  description?: string;
  acceptsLaunchPayload?: boolean;
  iconDataUrl?: string;
}

export interface SystemRecorderSource {
  id: string;
  kind: SystemRecorderSourceKind;
  name: string;
  displayId?: string;
  thumbnailDataUrl?: string;
  appIconDataUrl?: string;
}

export interface SystemRecorderState {
  available: boolean;
  recording: boolean;
  transcoding: boolean;
  transcodeToMp4?: boolean;
  transcodeProgressPercent?: number | null;
  mode: SystemRecorderSourceKind | null;
  sourceId: string | null;
  sourceName: string | null;
  outputPath: string | null;
  startedAt: number | null;
  lastError: string | null;
  ffmpegConfiguredPath?: string;
  ffmpegResolvedPath?: string | null;
}

export interface StartSystemRecorderInput {
  mode: SystemRecorderSourceKind;
  sourceId: string;
  captureAudio?: boolean;
  transcodeToMp4?: boolean;
}

export interface SystemRecorderStartResult {
  canceled: boolean;
  sessionId: string | null;
  outputPath: string | null;
  state: SystemRecorderState;
}
