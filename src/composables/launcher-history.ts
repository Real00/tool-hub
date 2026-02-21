const LAUNCHER_HISTORY_STORAGE_KEY = "tool-hub.launcher-history.v1";
const LAUNCHER_HISTORY_EVENT = "tool-hub:launcher-history-updated";
const MAX_LAUNCHER_HISTORY_ITEMS = 80;

export type LauncherHistoryKind = "system" | "installed";

export interface LauncherHistoryItem {
  key: string;
  kind: LauncherHistoryKind;
  targetId: string;
  name: string;
  source: string;
  acceptsLaunchPayload: boolean;
  favorite: boolean;
  launchCount: number;
  lastLaunchedAt: number;
}

interface RecordLaunchInput {
  kind: LauncherHistoryKind;
  targetId: string;
  name: string;
  source: string;
  acceptsLaunchPayload: boolean;
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

function emitLauncherHistoryUpdated() {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(LAUNCHER_HISTORY_EVENT));
}

function sortHistory(items: LauncherHistoryItem[]): LauncherHistoryItem[] {
  return [...items].sort((a, b) => {
    if (a.favorite !== b.favorite) {
      return a.favorite ? -1 : 1;
    }
    if (a.lastLaunchedAt !== b.lastLaunchedAt) {
      return b.lastLaunchedAt - a.lastLaunchedAt;
    }
    if (a.launchCount !== b.launchCount) {
      return b.launchCount - a.launchCount;
    }
    return a.name.localeCompare(b.name);
  });
}

function normalizeHistoryItem(input: unknown): LauncherHistoryItem | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const candidate = input as Partial<LauncherHistoryItem>;
  const kind = candidate.kind === "system" ? "system" : candidate.kind === "installed" ? "installed" : null;
  const targetId = String(candidate.targetId ?? "").trim();
  const name = String(candidate.name ?? "").trim();
  if (!kind || !targetId || !name) {
    return null;
  }

  const source = String(candidate.source ?? "").trim() || (kind === "system" ? "System" : "Installed");
  const key = makeLauncherHistoryKey(kind, targetId);
  const launchCount = Number(candidate.launchCount ?? 0);
  const lastLaunchedAt = Number(candidate.lastLaunchedAt ?? 0);
  return {
    key,
    kind,
    targetId,
    name,
    source,
    acceptsLaunchPayload: candidate.acceptsLaunchPayload === true,
    favorite: candidate.favorite === true,
    launchCount: Number.isFinite(launchCount) ? Math.max(0, Math.floor(launchCount)) : 0,
    lastLaunchedAt: Number.isFinite(lastLaunchedAt) ? Math.max(0, Math.floor(lastLaunchedAt)) : 0,
  };
}

function persistHistory(items: LauncherHistoryItem[]) {
  if (!canUseStorage()) {
    return;
  }
  const sorted = sortHistory(items).slice(0, MAX_LAUNCHER_HISTORY_ITEMS);
  try {
    window.localStorage.setItem(
      LAUNCHER_HISTORY_STORAGE_KEY,
      JSON.stringify(sorted),
    );
    emitLauncherHistoryUpdated();
  } catch {
    // Ignore quota/storage errors.
  }
}

export function makeLauncherHistoryKey(
  kind: LauncherHistoryKind,
  targetId: string,
): string {
  return `${kind}:${targetId.trim().toLowerCase()}`;
}

export function readLauncherHistory(): LauncherHistoryItem[] {
  if (!canUseStorage()) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(LAUNCHER_HISTORY_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const normalized = parsed
      .map((item) => normalizeHistoryItem(item))
      .filter((item): item is LauncherHistoryItem => !!item);
    return sortHistory(normalized).slice(0, MAX_LAUNCHER_HISTORY_ITEMS);
  } catch {
    return [];
  }
}

export function readLauncherHistoryMap(): Map<string, LauncherHistoryItem> {
  const output = new Map<string, LauncherHistoryItem>();
  readLauncherHistory().forEach((item) => {
    output.set(item.key, item);
  });
  return output;
}

export function recordLauncherLaunch(input: RecordLaunchInput) {
  const kind: LauncherHistoryKind = input.kind === "system" ? "system" : "installed";
  const targetId = String(input.targetId ?? "").trim();
  const name = String(input.name ?? "").trim();
  if (!targetId || !name) {
    return;
  }

  const key = makeLauncherHistoryKey(kind, targetId);
  const current = readLauncherHistory();
  const existing = current.find((item) => item.key === key);
  const now = Date.now();
  const nextItem: LauncherHistoryItem = {
    key,
    kind,
    targetId,
    name,
    source: String(input.source ?? "").trim() || (kind === "system" ? "System" : "Installed"),
    acceptsLaunchPayload: input.acceptsLaunchPayload === true,
    favorite: existing?.favorite === true,
    launchCount: (existing?.launchCount ?? 0) + 1,
    lastLaunchedAt: now,
  };

  const merged = [nextItem, ...current.filter((item) => item.key !== key)];
  persistHistory(merged);
}

export function toggleLauncherFavorite(keyInput: string): boolean {
  const key = String(keyInput ?? "").trim().toLowerCase();
  if (!key) {
    return false;
  }

  const current = readLauncherHistory();
  let nextFavorite = false;
  const next = current.map((item) => {
    if (item.key !== key) {
      return item;
    }
    nextFavorite = !item.favorite;
    return {
      ...item,
      favorite: nextFavorite,
    };
  });
  persistHistory(next);
  return nextFavorite;
}

export function subscribeLauncherHistoryUpdates(callback: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const listener = () => {
    callback();
  };
  window.addEventListener(LAUNCHER_HISTORY_EVENT, listener);
  return () => {
    window.removeEventListener(LAUNCHER_HISTORY_EVENT, listener);
  };
}

export function computeLauncherHistoryBoost(item: LauncherHistoryItem | null | undefined): number {
  if (!item) {
    return 0;
  }
  const now = Date.now();
  const ageHours = Math.max(0, (now - item.lastLaunchedAt) / (1000 * 60 * 60));
  const recencyBoost = Math.max(0, 200 - ageHours * 2.5);
  const frequencyBoost = Math.min(140, item.launchCount * 12);
  const favoriteBoost = item.favorite ? 260 : 0;
  return favoriteBoost + recencyBoost + frequencyBoost;
}

export function getRecentLauncherHistory(limit = 12): LauncherHistoryItem[] {
  const numericLimit = Number(limit);
  if (!Number.isFinite(numericLimit) || numericLimit <= 0) {
    return [];
  }
  return readLauncherHistory().slice(0, Math.floor(numericLimit));
}
