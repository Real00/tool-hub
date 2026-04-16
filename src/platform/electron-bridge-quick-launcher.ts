import type {
  ClipboardPathContext,
  ContextDispatchRequest,
} from "../types/app";
import type { QuickLauncherHotkeyState } from "../types/settings";
import type { QuickLauncherClipboardDeveloperToolsContext } from "../types/developer-tools";
import {
  getApi,
  type QuickLauncherWindowSizePayload,
} from "./electron-bridge-runtime";

export type { QuickLauncherWindowSizePayload } from "./electron-bridge-runtime";

export function closeQuickLauncherWindow(): Promise<boolean> {
  return getApi().closeQuickLauncherWindow();
}

export function getQuickLauncherHotkeyState(): Promise<QuickLauncherHotkeyState> {
  return getApi().getQuickLauncherHotkeyState();
}

export function saveQuickLauncherHotkey(
  accelerator: string,
): Promise<QuickLauncherHotkeyState> {
  return getApi().saveQuickLauncherHotkey(accelerator);
}

export function applyQuickLauncherHotkey(
  accelerator?: string,
): Promise<QuickLauncherHotkeyState> {
  return getApi().applyQuickLauncherHotkey(accelerator);
}

export function retryQuickLauncherHotkey(): Promise<QuickLauncherHotkeyState> {
  return getApi().retryQuickLauncherHotkey();
}

export function getQuickLauncherClipboardPathContext(): Promise<ClipboardPathContext | null> {
  return getApi().getQuickLauncherClipboardPathContext();
}

export function getQuickLauncherClipboardDeveloperToolsContext(): Promise<QuickLauncherClipboardDeveloperToolsContext | null> {
  return getApi().getQuickLauncherClipboardDeveloperToolsContext();
}

export function openClipboardPathFile(path: string): Promise<boolean> {
  return getApi().openClipboardPathFile(path);
}

export function openClipboardPathLocation(path: string): Promise<boolean> {
  return getApi().openClipboardPathLocation(path);
}

export function setQuickLauncherWindowSize(
  payload: QuickLauncherWindowSizePayload,
): Promise<boolean> {
  return getApi().setQuickLauncherWindowSize(payload);
}

export function subscribeQuickLauncherRequest(callback: () => void): () => void {
  return getApi().subscribeQuickLauncherRequest(callback);
}

export function subscribeContextDispatchRequest(
  callback: (payload: ContextDispatchRequest) => void,
): () => void {
  return getApi().subscribeContextDispatchRequest(callback);
}
