const fs = require("node:fs");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const { app: electronApp, shell } = require("electron");
const { getBuiltinSystemTools } = require("./system-tools-registry.cjs");

const execFileAsync = promisify(execFile);

const SEARCH_LIMIT_DEFAULT = 12;
const SEARCH_LIMIT_MAX = 50;
const INDEX_TTL_MS = 5 * 60 * 1000;
const START_MENU_EXTENSIONS = new Set([".lnk", ".url", ".appref-ms", ".exe"]);
const SOURCE_ORDER = ["System Tool", "Start Menu", "UWP"];
const IMAGE_ICON_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".ico", ".svg"]);
const IMAGE_MIME_BY_EXTENSION = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};
const PINYIN_INITIAL_MAP = new Map([
  ["设", "s"], ["备", "b"], ["管", "g"], ["理", "l"], ["器", "q"],
  ["控", "k"], ["制", "z"], ["面", "m"], ["板", "b"],
  ["卸", "x"], ["载", "z"], ["或", "h"], ["更", "g"], ["改", "g"], ["程", "c"], ["序", "x"],
  ["添", "t"], ["加", "j"], ["删", "s"], ["除", "c"],
  ["服", "f"], ["务", "w"], ["磁", "c"], ["盘", "p"],
  ["计", "j"], ["算", "s"], ["机", "j"], ["任", "r"], ["注", "z"], ["册", "c"], ["表", "b"],
  ["编", "b"], ["辑", "j"], ["命", "m"], ["令", "l"], ["提", "t"], ["示", "s"], ["符", "f"],
  ["系", "x"], ["统", "t"], ["信", "x"], ["息", "x"], ["电", "d"], ["脑", "n"], ["硬", "y"],
  ["件", "j"], ["驱", "q"], ["动", "d"], ["工", "g"], ["具", "j"], ["开", "k"], ["关", "g"],
]);

const indexState = {
  items: [],
  byId: new Map(),
  updatedAt: 0,
  refreshPromise: null,
};

const iconState = {
  cache: new Map(),
  inFlight: new Map(),
};

function isWindowsRuntime() {
  return process.platform === "win32";
}

function normalizeText(input) {
  return String(input ?? "")
    .toLowerCase()
    .replace(/[_\-.]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function squashSpaces(input) {
  return normalizeText(input).replace(/\s+/g, "");
}

function tokenize(input) {
  return normalizeText(input)
    .split(" ")
    .filter(Boolean);
}

function stripFileExtension(fileName) {
  return String(fileName ?? "").replace(/\.[^.]+$/, "");
}

function isSubsequence(needle, haystack) {
  if (!needle) {
    return true;
  }
  let cursor = 0;
  for (let i = 0; i < haystack.length; i += 1) {
    if (haystack[i] === needle[cursor]) {
      cursor += 1;
      if (cursor >= needle.length) {
        return true;
      }
    }
  }
  return false;
}

function normalizeLaunchTarget(input) {
  return String(input ?? "").trim().toLowerCase();
}

function sourceRank(source) {
  const index = SOURCE_ORDER.indexOf(source);
  return index >= 0 ? index : SOURCE_ORDER.length + 1;
}

function isAsciiAlphaNumeric(char) {
  return /^[a-z0-9]$/i.test(char);
}

function isCjkChar(char) {
  const code = char.charCodeAt(0);
  return code >= 0x4e00 && code <= 0x9fff;
}

function buildPinyinInitials(parts) {
  const source = Array.isArray(parts) ? parts.join(" ") : String(parts ?? "");
  let output = "";

  for (const char of source) {
    const lowerChar = char.toLowerCase();
    if (isAsciiAlphaNumeric(lowerChar)) {
      output += lowerChar;
      continue;
    }
    if (!isCjkChar(char)) {
      continue;
    }
    const mapped = PINYIN_INITIAL_MAP.get(char);
    if (mapped) {
      output += mapped;
    }
  }

  return output;
}

function formatSourceSet(sourceSet) {
  return Array.from(sourceSet)
    .sort((a, b) => sourceRank(a) - sourceRank(b))
    .join(" / ");
}

function makeSearchText(name, launchTarget, keywords = [], source = "") {
  return normalizeText([name, launchTarget, source, ...keywords].join(" "));
}

function expandEnvironmentVariables(input) {
  const value = String(input ?? "");
  if (!value.includes("%")) {
    return value;
  }
  return value.replace(/%([^%]+)%/g, (_match, variableName) => {
    const envValue = process.env[variableName];
    return envValue ? envValue : `%${variableName}%`;
  });
}

function stripWrappingQuotes(input) {
  const value = String(input ?? "").trim();
  if (value.startsWith("\"") && value.endsWith("\"")) {
    return value.slice(1, -1);
  }
  return value;
}

function stripIconIndex(input) {
  const value = stripWrappingQuotes(input);
  const match = value.match(/^(.*),\s*(-?\d+)$/);
  if (!match) {
    return value;
  }
  return String(match[1] ?? "").trim();
}

function normalizeAbsolutePathCandidate(input) {
  const value = stripWrappingQuotes(expandEnvironmentVariables(input)).trim();
  if (!value || !path.isAbsolute(value)) {
    return null;
  }
  return value;
}

function chunkArray(items, chunkSize) {
  const output = [];
  if (!Array.isArray(items) || items.length === 0) {
    return output;
  }
  const size = Math.max(1, Number(chunkSize) || 1);
  for (let i = 0; i < items.length; i += size) {
    output.push(items.slice(i, i + size));
  }
  return output;
}

async function resolveStartMenuShortcutMetadata(shortcutPaths) {
  if (!Array.isArray(shortcutPaths) || shortcutPaths.length === 0) {
    return [];
  }

  const batches = chunkArray(shortcutPaths, 40);
  const output = [];

  for (const batch of batches) {
    const payload = Buffer.from(JSON.stringify(batch), "utf8").toString("base64");
    const command = [
      `$json=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))`,
      "$items=$json|ConvertFrom-Json",
      "if($items -isnot [System.Array]){$items=@($items)}",
      "$shell=New-Object -ComObject WScript.Shell",
      "$rows=@()",
      "foreach($item in $items){",
      "  try{",
      "    $shortcut=$shell.CreateShortcut([string]$item)",
      "    $rows+=[pscustomobject]@{",
      "      shortcutPath=[string]$item;",
      "      targetPath=[string]$shortcut.TargetPath;",
      "      iconLocation=[string]$shortcut.IconLocation;",
      "    }",
      "  }catch{}",
      "}",
      "$rows|ConvertTo-Json -Compress",
    ].join(";");

    try {
      const { stdout } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
        {
          windowsHide: true,
          maxBuffer: 4 * 1024 * 1024,
        },
      );
      const json = String(stdout ?? "").trim();
      if (!json) {
        continue;
      }
      const parsed = JSON.parse(json);
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      output.push(...rows);
    } catch {
      // Skip failed batch and continue.
    }
  }

  return output;
}

async function resolveInternetShortcutIconPath(filePath) {
  try {
    const raw = await fs.promises.readFile(filePath, "utf8");
    const iconFileLine = raw
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .find((line) => line.toLowerCase().startsWith("iconfile="));
    if (!iconFileLine) {
      return null;
    }
    const iconPath = iconFileLine.slice("iconfile=".length).trim();
    return normalizeAbsolutePathCandidate(iconPath);
  } catch {
    return null;
  }
}

async function enrichStartMenuAppIcons(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return items;
  }

  const shortcutPaths = items
    .filter((item) => path.extname(item.launchTarget).toLowerCase() === ".lnk")
    .map((item) => item.launchTarget);
  const shortcutRows = await resolveStartMenuShortcutMetadata(shortcutPaths);
  const shortcutByPath = new Map(
    shortcutRows.map((row) => [String(row?.shortcutPath ?? "").toLowerCase(), row]),
  );

  const urlIconPromises = items.map(async (item) => {
    const extension = path.extname(item.launchTarget).toLowerCase();
    if (extension !== ".url") {
      return null;
    }
    const iconPath = await resolveInternetShortcutIconPath(item.launchTarget);
    return {
      launchTarget: item.launchTarget.toLowerCase(),
      iconPath,
    };
  });
  const urlIconRows = await Promise.all(urlIconPromises);
  const urlIconByPath = new Map(
    urlIconRows
      .filter((row) => row && row.iconPath)
      .map((row) => [row.launchTarget, row.iconPath]),
  );

  for (const item of items) {
    const extension = path.extname(item.launchTarget).toLowerCase();

    if (extension === ".lnk") {
      const row = shortcutByPath.get(item.launchTarget.toLowerCase());
      if (!row) {
        continue;
      }

      const iconFromLocation = normalizeAbsolutePathCandidate(stripIconIndex(row.iconLocation));
      const iconFromTarget = normalizeAbsolutePathCandidate(row.targetPath);
      const nextIconPath = iconFromLocation || iconFromTarget;
      if (nextIconPath) {
        item.iconPath = nextIconPath;
      }
      continue;
    }

    if (extension === ".url") {
      const nextIconPath = urlIconByPath.get(item.launchTarget.toLowerCase());
      if (nextIconPath) {
        item.iconPath = nextIconPath;
      }
    }
  }

  return items;
}

async function resolveUwpIconPathMap(appIds) {
  if (!Array.isArray(appIds) || appIds.length === 0) {
    return new Map();
  }

  const output = new Map();
  const batches = chunkArray(appIds, 60);

  for (const batch of batches) {
    const payload = Buffer.from(JSON.stringify(batch), "utf8").toString("base64");
    const command = [
      `$json=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))`,
      "$items=$json|ConvertFrom-Json",
      "if($items -isnot [System.Array]){$items=@($items)}",
      "$packagesByFamily=@{}",
      "foreach($pkg in (Get-AppxPackage -ErrorAction SilentlyContinue)){",
      "  $family=[string]$pkg.PackageFamilyName",
      "  if(-not $family){continue}",
      "  if(-not $packagesByFamily.ContainsKey($family)){",
      "    $packagesByFamily[$family]=$pkg",
      "  }",
      "}",
      "function Resolve-UwpLogoPath([string]$installLocation,[string]$logoValue){",
      "  if(-not $installLocation -or -not $logoValue){return $null}",
      "  if($logoValue.StartsWith('ms-resource:', [System.StringComparison]::OrdinalIgnoreCase)){return $null}",
      "  $relative=$logoValue.Replace('/','\\')",
      "  $basePath=Join-Path $installLocation $relative",
      "  if(Test-Path -LiteralPath $basePath){return $basePath}",
      "  $dir=[System.IO.Path]::GetDirectoryName($basePath)",
      "  $name=[System.IO.Path]::GetFileNameWithoutExtension($basePath)",
      "  $ext=[System.IO.Path]::GetExtension($basePath)",
      "  if(-not $dir -or -not (Test-Path -LiteralPath $dir)){return $null}",
      "  $candidates=Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue |",
      "    Where-Object { $_.BaseName -like ($name + '*') -and $_.Extension -eq $ext } |",
      "    Sort-Object Name",
      "  if($candidates.Count -gt 0){",
      "    $preferred=$candidates | Where-Object { $_.Name -match 'targetsize-32|targetsize-48|scale-200|scale-100' } | Select-Object -First 1",
      "    if($preferred){return $preferred.FullName}",
      "    return $candidates[0].FullName",
      "  }",
      "  return $null",
      "}",
      "$rows=@()",
      "foreach($item in $items){",
      "  try{",
      "    $appId=[string]$item",
      "    if(-not $appId -or -not $appId.Contains('!')){continue}",
      "    $parts=$appId -split '!',2",
      "    $family=[string]$parts[0]",
      "    $applicationId=[string]$parts[1]",
      "    if(-not $packagesByFamily.ContainsKey($family)){continue}",
      "    $package=$packagesByFamily[$family]",
      "    $installLocation=[string]$package.InstallLocation",
      "    if(-not $installLocation){continue}",
      "    $manifestPath=Join-Path $installLocation 'AppxManifest.xml'",
      "    if(-not (Test-Path -LiteralPath $manifestPath)){continue}",
      "    [xml]$manifest=Get-Content -LiteralPath $manifestPath",
      "    $applications=$manifest.GetElementsByTagName('Application')",
      "    $appNode=$null",
      "    foreach($node in $applications){",
      "      if([string]$node.GetAttribute('Id') -eq $applicationId){",
      "        $appNode=$node",
      "        break",
      "      }",
      "    }",
      "    if(-not $appNode){continue}",
      "    $logoCandidates=@(",
      "      [string]$appNode.GetAttribute('Square44x44Logo'),",
      "      [string]$appNode.GetAttribute('Square150x150Logo'),",
      "      [string]$appNode.GetAttribute('Logo')",
      "    )",
      "    foreach($child in $appNode.ChildNodes){",
      "      if($child.LocalName -ne 'VisualElements'){continue}",
      "      $logoCandidates += @(",
      "        [string]$child.GetAttribute('Square44x44Logo'),",
      "        [string]$child.GetAttribute('Square150x150Logo'),",
      "        [string]$child.GetAttribute('Logo')",
      "      )",
      "    }",
      "    $resolvedPath=$null",
      "    foreach($logoValue in $logoCandidates){",
      "      if(-not $logoValue){continue}",
      "      $resolvedPath=Resolve-UwpLogoPath $installLocation $logoValue",
      "      if($resolvedPath){break}",
      "    }",
      "    if(-not $resolvedPath){continue}",
      "    $rows+=[pscustomobject]@{appId=$appId;iconPath=$resolvedPath}",
      "  }catch{}",
      "}",
      "$rows|ConvertTo-Json -Compress",
    ].join(";");

    try {
      const { stdout } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
        {
          windowsHide: true,
          maxBuffer: 8 * 1024 * 1024,
        },
      );
      const json = String(stdout ?? "").trim();
      if (!json) {
        continue;
      }
      const parsed = JSON.parse(json);
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      for (const row of rows) {
        if (!row?.appId || !row?.iconPath) {
          continue;
        }
        output.set(String(row.appId).toLowerCase(), String(row.iconPath));
      }
    } catch {
      // Skip failed batch and continue.
    }
  }

  return output;
}

async function enrichUwpAppIcons(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return items;
  }

  const appIds = items
    .filter((item) => item.launchType === "uwp")
    .map((item) => item.launchTarget);
  const iconPathMap = await resolveUwpIconPathMap(appIds);
  if (iconPathMap.size === 0) {
    return items;
  }

  for (const item of items) {
    if (item.launchType !== "uwp") {
      continue;
    }
    const iconPath = iconPathMap.get(String(item.launchTarget).toLowerCase());
    if (iconPath) {
      item.iconPath = iconPath;
    }
  }

  return items;
}

function getStartMenuScanRoots() {
  const roots = [];

  const programData = process.env.ProgramData;
  if (programData) {
    roots.push({
      path: path.join(programData, "Microsoft", "Windows", "Start Menu", "Programs"),
      sourceLabel: "Start Menu",
    });
  }

  const appData = process.env.APPDATA;
  if (appData) {
    roots.push({
      path: path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs"),
      sourceLabel: "Start Menu",
    });
  }

  return roots;
}

async function walkStartMenuEntries(currentDir, sourceLabel, relativeDir, output) {
  let entries = [];
  try {
    entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    const nextRelativeDir = relativeDir ? path.join(relativeDir, entry.name) : entry.name;

    if (entry.isDirectory()) {
      await walkStartMenuEntries(absolutePath, sourceLabel, nextRelativeDir, output);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (!START_MENU_EXTENSIONS.has(extension)) {
      continue;
    }

    const baseName = stripFileExtension(entry.name).trim();
    if (!baseName) {
      continue;
    }

    const id = `path:${absolutePath.toLowerCase()}`;
    output.push({
      id,
      name: baseName,
      source: sourceLabel,
      launchType: "path",
      launchTarget: absolutePath,
      launchArgs: [],
      iconPath: absolutePath,
      keywords: [stripFileExtension(nextRelativeDir)],
      matchBoost: 0,
      searchText: makeSearchText(baseName, absolutePath, [stripFileExtension(nextRelativeDir)], sourceLabel),
      pinyinInitials: buildPinyinInitials([baseName, stripFileExtension(nextRelativeDir)]),
    });
  }
}

async function collectStartMenuApps() {
  const items = [];
  const roots = getStartMenuScanRoots();

  for (const root of roots) {
    await walkStartMenuEntries(root.path, root.sourceLabel, "", items);
  }

  await enrichStartMenuAppIcons(items);
  return items;
}

async function collectUwpApps() {
  const command = "Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress";
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      {
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      },
    );

    const json = String(stdout ?? "").trim();
    if (!json) {
      return [];
    }

    const parsed = JSON.parse(json);
    const rows = Array.isArray(parsed) ? parsed : [parsed];

    const output = [];
    for (const row of rows) {
      const name = String(row?.Name ?? "").trim();
      const appId = String(row?.AppID ?? "").trim();
      if (!name || !appId) {
        continue;
      }
      const id = `uwp:${appId.toLowerCase()}`;
      output.push({
        id,
        name,
        source: "UWP",
        launchType: "uwp",
        launchTarget: appId,
        launchArgs: [],
        iconPath: null,
        keywords: [],
        matchBoost: 0,
        searchText: makeSearchText(name, appId, [], "UWP"),
        pinyinInitials: buildPinyinInitials([name]),
      });
    }
    await enrichUwpAppIcons(output);
    return output;
  } catch {
    return [];
  }
}

function collectBuiltinApps() {
  return getBuiltinSystemTools().map((item) => ({
    ...item,
    searchText: makeSearchText(item.name, item.launchTarget, item.keywords, item.source),
    pinyinInitials: buildPinyinInitials([item.name, ...(item.keywords || [])]),
  }));
}

function buildDedupeKey(item) {
  if (item.launchType === "command") {
    return `command:${normalizeLaunchTarget(item.launchTarget)}:${item.launchArgs
      .map((arg) => normalizeLaunchTarget(arg))
      .join("|")}`;
  }
  return `${item.launchType}:${normalizeLaunchTarget(item.launchTarget)}`;
}

function dedupeScore(item) {
  let score = 0;
  score += item.matchBoost || 0;
  if (item.source === "System Tool") {
    score += 80;
  }
  if (item.source === "Start Menu") {
    score += 40;
  }
  if (item.source === "UWP") {
    score += 20;
  }
  score -= item.name.length * 0.1;
  return score;
}

function dedupeApps(items) {
  const uniqueByLaunch = new Map();

  for (const item of items) {
    const key = buildDedupeKey(item);
    const existing = uniqueByLaunch.get(key);
    if (!existing) {
      uniqueByLaunch.set(key, item);
      continue;
    }

    if (dedupeScore(item) > dedupeScore(existing)) {
      uniqueByLaunch.set(key, item);
    }
  }

  return Array.from(uniqueByLaunch.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function dedupeByName(items) {
  const uniqueByName = new Map();

  for (const item of items) {
    const key = squashSpaces(item.name);
    if (!key) {
      uniqueByName.set(`__id:${item.id}`, {
        ...item,
        sourceSet: new Set([item.source]),
      });
      continue;
    }

    const existing = uniqueByName.get(key);
    if (!existing) {
      uniqueByName.set(key, {
        ...item,
        sourceSet: new Set([item.source]),
      });
      continue;
    }

    existing.sourceSet.add(item.source);

    if (dedupeScore(item) > dedupeScore(existing)) {
      const mergedSet = existing.sourceSet;
      uniqueByName.set(key, {
        ...item,
        sourceSet: mergedSet,
      });
    }
  }

  const output = [];
  for (const value of uniqueByName.values()) {
    output.push({
      ...value,
      source: formatSourceSet(value.sourceSet || new Set([value.source])),
    });
  }
  return output.sort((a, b) => a.name.localeCompare(b.name));
}

async function refreshSystemAppsIndex() {
  if (!isWindowsRuntime()) {
    indexState.items = [];
    indexState.byId = new Map();
    indexState.updatedAt = Date.now();
    return 0;
  }

  if (indexState.refreshPromise) {
    return indexState.refreshPromise;
  }

  indexState.refreshPromise = (async () => {
    const [startMenuApps, uwpApps] = await Promise.all([
      collectStartMenuApps(),
      collectUwpApps(),
    ]);
    const builtinApps = collectBuiltinApps();

    const mergedByLaunch = dedupeApps([...startMenuApps, ...uwpApps, ...builtinApps]);
    const merged = dedupeByName(mergedByLaunch);
    indexState.items = merged;
    indexState.byId = new Map(merged.map((item) => [item.id, item]));
    indexState.updatedAt = Date.now();
    return merged.length;
  })()
    .finally(() => {
      indexState.refreshPromise = null;
    });

  return indexState.refreshPromise;
}

async function ensureIndexReady() {
  const isStale = Date.now() - indexState.updatedAt > INDEX_TTL_MS;
  if (indexState.items.length === 0 || isStale) {
    await refreshSystemAppsIndex();
  }
}

function computeSearchScore(item, normalizedQuery, queryTokens) {
  if (!normalizedQuery || queryTokens.length === 0) {
    return -1;
  }

  const name = normalizeText(item.name);
  const text = item.searchText;
  const nameSquashed = squashSpaces(item.name);
  const textSquashed = text.replace(/\s+/g, "");
  const querySquashed = normalizedQuery.replace(/\s+/g, "");
  const pinyinInitials = String(item.pinyinInitials || "");
  let score = item.matchBoost || 0;

  if (name === normalizedQuery) {
    score += 1200;
  } else if (name.startsWith(normalizedQuery)) {
    score += 900;
  } else if (name.includes(normalizedQuery)) {
    score += 600;
  } else if (text.includes(normalizedQuery)) {
    score += 350;
  }

  if (querySquashed && isSubsequence(querySquashed, nameSquashed)) {
    score += 160;
  } else if (querySquashed && isSubsequence(querySquashed, textSquashed)) {
    score += 90;
  }

  if (querySquashed && pinyinInitials) {
    if (pinyinInitials.startsWith(querySquashed)) {
      score += 650;
    } else if (pinyinInitials.includes(querySquashed)) {
      score += 420;
    } else if (isSubsequence(querySquashed, pinyinInitials)) {
      score += 160;
    }
  }

  for (const token of queryTokens) {
    const tokenSquashed = token.replace(/\s+/g, "");
    if (name.startsWith(token)) {
      score += 180;
      continue;
    }
    if (name.includes(token)) {
      score += 140;
      continue;
    }
    if (text.includes(token)) {
      score += 90;
      continue;
    }
    if (tokenSquashed && pinyinInitials.includes(tokenSquashed)) {
      score += 130;
      continue;
    }
    if (tokenSquashed && isSubsequence(tokenSquashed, pinyinInitials)) {
      score += 55;
      continue;
    }
    if (
      tokenSquashed &&
      (isSubsequence(tokenSquashed, nameSquashed) || isSubsequence(tokenSquashed, textSquashed))
    ) {
      score += 50;
      continue;
    }
    return -1;
  }

  return score;
}

function normalizeSearchLimit(input) {
  const numeric = Number(input);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return SEARCH_LIMIT_DEFAULT;
  }
  return Math.max(1, Math.min(SEARCH_LIMIT_MAX, Math.floor(numeric)));
}

function getIconLookupPath(entry) {
  if (entry.iconPath && path.isAbsolute(entry.iconPath)) {
    return entry.iconPath;
  }
  if (entry.launchType === "path" && path.isAbsolute(entry.launchTarget)) {
    return entry.launchTarget;
  }
  if (entry.launchType === "command" && path.isAbsolute(entry.launchTarget)) {
    return entry.launchTarget;
  }
  return null;
}

function getImageMimeTypeByPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (!IMAGE_ICON_EXTENSIONS.has(extension)) {
    return null;
  }
  return IMAGE_MIME_BY_EXTENSION[extension] || "application/octet-stream";
}

async function loadIconDataUrl(iconPath) {
  if (!iconPath) {
    return null;
  }

  const cacheKey = iconPath.toLowerCase();
  if (iconState.cache.has(cacheKey)) {
    return iconState.cache.get(cacheKey);
  }
  if (iconState.inFlight.has(cacheKey)) {
    return iconState.inFlight.get(cacheKey);
  }

  const promise = (async () => {
    try {
      const mimeType = getImageMimeTypeByPath(iconPath);
      if (mimeType) {
        try {
          const fileBuffer = await fs.promises.readFile(iconPath);
          const dataUrl = `data:${mimeType};base64,${fileBuffer.toString("base64")}`;
          iconState.cache.set(cacheKey, dataUrl);
          return dataUrl;
        } catch {
          // Fall through to getFileIcon for paths that are protected but shell-resolvable.
        }
      }

      const image = await electronApp.getFileIcon(iconPath, { size: "small" });
      if (!image || image.isEmpty()) {
        iconState.cache.set(cacheKey, null);
        return null;
      }
      const dataUrl = image.toDataURL();
      iconState.cache.set(cacheKey, dataUrl);
      return dataUrl;
    } catch {
      iconState.cache.set(cacheKey, null);
      return null;
    } finally {
      iconState.inFlight.delete(cacheKey);
    }
  })();

  iconState.inFlight.set(cacheKey, promise);
  return promise;
}

async function toPublicEntry(entry) {
  const iconPath = getIconLookupPath(entry);
  const iconDataUrl = await loadIconDataUrl(iconPath);
  return {
    id: entry.id,
    name: entry.name,
    source: entry.source,
    launchType: entry.launchType,
    iconDataUrl: iconDataUrl || undefined,
  };
}

async function searchSystemApps(queryInput, limitInput = SEARCH_LIMIT_DEFAULT) {
  if (!isWindowsRuntime()) {
    return [];
  }

  const query = String(queryInput ?? "").trim();
  if (!query) {
    return [];
  }

  await ensureIndexReady();

  const normalizedQuery = normalizeText(query);
  const queryTokens = tokenize(query);
  const limit = normalizeSearchLimit(limitInput);

  const scored = [];
  for (const item of indexState.items) {
    const score = computeSearchScore(item, normalizedQuery, queryTokens);
    if (score < 0) {
      continue;
    }
    scored.push({ score, item });
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score;
    }
    return a.item.name.localeCompare(b.item.name);
  });

  const topEntries = scored.slice(0, limit).map(({ item }) => item);
  return Promise.all(topEntries.map((entry) => toPublicEntry(entry)));
}

async function openSystemApp(appIdInput) {
  if (!isWindowsRuntime()) {
    throw new Error("System app launcher is available on Windows only.");
  }

  const appId = String(appIdInput ?? "").trim();
  if (!appId) {
    throw new Error("App id is required.");
  }

  await ensureIndexReady();
  let appEntry = indexState.byId.get(appId);
  if (!appEntry) {
    await refreshSystemAppsIndex();
    appEntry = indexState.byId.get(appId);
  }
  if (!appEntry) {
    throw new Error(`App not found in system index: ${appId}`);
  }

  if (appEntry.launchType === "path") {
    const errorMessage = await shell.openPath(appEntry.launchTarget);
    if (errorMessage) {
      throw new Error(errorMessage);
    }
    return true;
  }

  if (appEntry.launchType === "uwp") {
    await execFileAsync(
      "explorer.exe",
      [`shell:AppsFolder\\${appEntry.launchTarget}`],
      { windowsHide: true },
    );
    return true;
  }

  if (appEntry.launchType === "command") {
    await new Promise((resolve, reject) => {
      const child = spawn(
        appEntry.launchTarget,
        Array.isArray(appEntry.launchArgs) ? appEntry.launchArgs : [],
        {
          windowsHide: true,
          detached: true,
          stdio: "ignore",
        },
      );
      child.once("error", reject);
      child.unref();
      resolve();
    });
    return true;
  }

  throw new Error(`Unsupported launch type: ${appEntry.launchType}`);
}

module.exports = {
  openSystemApp,
  refreshSystemAppsIndex,
  searchSystemApps,
};
