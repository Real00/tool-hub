import type {
  StartSystemRecorderInput,
  SystemAppEntry,
  SystemRecorderSource,
  SystemRecorderSourceKind,
  SystemRecorderStartResult,
  SystemRecorderState,
} from "../types/system-app";
import { getApi } from "./electron-bridge-runtime";

export function refreshSystemAppsIndex(): Promise<number> {
  return getApi().refreshSystemAppsIndex();
}

export function listSystemApps(): Promise<SystemAppEntry[]> {
  return getApi().listSystemApps();
}

export function searchSystemApps(query: string, limit = 12): Promise<SystemAppEntry[]> {
  return getApi().searchSystemApps(query, limit);
}

export function getSystemAppsByIds(appIds: string[]): Promise<SystemAppEntry[]> {
  return getApi().getSystemAppsByIds(appIds);
}

export function openSystemApp(appId: string, launchPayload?: string): Promise<boolean> {
  return getApi().openSystemApp(appId, launchPayload);
}

export function getSystemRecorderState(): Promise<SystemRecorderState> {
  return getApi().getSystemRecorderState();
}

export function listSystemRecorderSources(
  mode: SystemRecorderSourceKind,
): Promise<SystemRecorderSource[]> {
  return getApi().listSystemRecorderSources(mode);
}

export function prepareSystemRecorderPreview(input: {
  mode: SystemRecorderSourceKind;
  sourceId: string;
}): Promise<boolean> {
  return getApi().prepareSystemRecorderPreview(input);
}

export function startSystemRecorder(
  input: StartSystemRecorderInput,
): Promise<SystemRecorderStartResult> {
  return getApi().startSystemRecorder(input);
}

export function appendSystemRecorderChunk(
  sessionId: string,
  chunk: Uint8Array,
): Promise<void> {
  return getApi().appendSystemRecorderChunk(sessionId, chunk);
}

export function finishSystemRecorder(sessionId: string): Promise<SystemRecorderState> {
  return getApi().finishSystemRecorder(sessionId);
}

export function abortSystemRecorder(
  sessionId: string,
  errorMessage = "",
): Promise<SystemRecorderState> {
  return getApi().abortSystemRecorder(sessionId, errorMessage);
}

export function pickSystemRecorderFfmpegPath(): Promise<{
  canceled: boolean;
  filePath: string;
  state: SystemRecorderState;
}> {
  return getApi().pickSystemRecorderFfmpegPath();
}

export function setSystemRecorderFfmpegPath(filePath: string): Promise<SystemRecorderState> {
  return getApi().setSystemRecorderFfmpegPath(filePath);
}
