import { computeLauncherHistoryBoost, makeLauncherHistoryKey } from "./launcher-history";
import type { LauncherHistoryItem } from "./launcher-history";
import type { InstalledApp } from "../types/app";

export interface InstalledLauncherSearchResult {
  id: string;
  name: string;
  source: string;
  kind: "installed";
  targetId: string;
  score: number;
  acceptsLaunchPayload: boolean;
  historyKey: string;
  favorite: boolean;
}

interface InstalledSearchCandidate {
  score: number;
  result: InstalledLauncherSearchResult;
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function computeInstalledScore(
  app: InstalledApp,
  normalizedQuery: string,
  tokens: string[],
): number {
  const normalizedName = app.name.toLowerCase();
  const normalizedId = app.id.toLowerCase();
  const normalizedTabId = app.tabId.toLowerCase();
  const combined = `${normalizedName} ${normalizedId} ${normalizedTabId}`;

  let score = 0;

  if (normalizedName === normalizedQuery) {
    score += 260;
  } else if (normalizedName.startsWith(normalizedQuery)) {
    score += 210;
  } else if (normalizedName.includes(normalizedQuery)) {
    score += 160;
  }

  if (normalizedId === normalizedQuery) {
    score += 180;
  } else if (normalizedId.startsWith(normalizedQuery)) {
    score += 130;
  } else if (normalizedId.includes(normalizedQuery)) {
    score += 90;
  }

  if (normalizedTabId.includes(normalizedQuery)) {
    score += 40;
  }

  for (let i = 0; i < tokens.length; i += 1) {
    if (combined.includes(tokens[i])) {
      score += 20;
    }
  }

  return score;
}

function isCandidateBetter(
  left: InstalledSearchCandidate,
  right: InstalledSearchCandidate,
): boolean {
  if (left.score !== right.score) {
    return left.score > right.score;
  }
  return left.result.name.localeCompare(right.result.name) < 0;
}

function pushTopInstalledCandidate(
  top: InstalledSearchCandidate[],
  next: InstalledSearchCandidate,
  limit: number,
) {
  if (top.length >= limit && !isCandidateBetter(next, top[top.length - 1])) {
    return;
  }

  let insertAt = top.length;
  for (let i = 0; i < top.length; i += 1) {
    if (isCandidateBetter(next, top[i])) {
      insertAt = i;
      break;
    }
  }

  top.splice(insertAt, 0, next);
  if (top.length > limit) {
    top.length = limit;
  }
}

export function searchInstalledLauncherApps(input: {
  installedApps: InstalledApp[];
  historyByKey: ReadonlyMap<string, LauncherHistoryItem>;
  query: string;
  limit?: number;
}): InstalledLauncherSearchResult[] {
  const normalizedQuery = input.query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  const numericLimit = Number(input.limit);
  const limit = Number.isFinite(numericLimit) && numericLimit > 0
    ? Math.floor(numericLimit)
    : 20;
  const tokens = tokenizeQuery(normalizedQuery);
  const top: InstalledSearchCandidate[] = [];

  for (let i = 0; i < input.installedApps.length; i += 1) {
    const app = input.installedApps[i];
    const baseScore = computeInstalledScore(app, normalizedQuery, tokens);
    if (baseScore <= 0) {
      continue;
    }

    const historyKey = makeLauncherHistoryKey("installed", app.id);
    const history = input.historyByKey.get(historyKey);
    const score = baseScore + computeLauncherHistoryBoost(history);
    pushTopInstalledCandidate(top, {
      score,
      result: {
        id: `installed:${app.id}`,
        kind: "installed",
        targetId: app.id,
        name: app.name,
        source: app.running ? "Installed / Running" : "Installed",
        score,
        acceptsLaunchPayload: true,
        historyKey,
        favorite: history?.favorite === true,
      },
    }, limit);
  }

  return top.map((item) => item.result);
}
