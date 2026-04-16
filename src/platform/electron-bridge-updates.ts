import type { UpdateState } from "../types/update";
import { getApi } from "./electron-bridge-runtime";

export function getUpdateState(): Promise<UpdateState> {
  return getApi().getUpdateState();
}

export function checkForUpdates(): Promise<UpdateState> {
  return getApi().checkForUpdates();
}

export function downloadUpdate(): Promise<UpdateState> {
  return getApi().downloadUpdate();
}

export function installUpdateAndRestart(): Promise<boolean> {
  return getApi().installUpdateAndRestart();
}

export function subscribeUpdateEvents(callback: (state: UpdateState) => void): () => void {
  return getApi().subscribeUpdateEvents(callback);
}
