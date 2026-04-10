const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const { app: electronApp, shell } = require("electron");
const { getBuiltinSystemTools } = require("./system-tools-registry.cjs");

const execFileAsync = promisify(execFile);

const SEARCH_LIMIT_DEFAULT = 12;
const SEARCH_LIMIT_MAX = 50;
const LOOKUP_BY_ID_LIMIT = 50;
const ICON_CACHE_DIR_NAME = "icon-cache";
const ICON_CACHE_FILE_VERSION = 1;
const ICON_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INDEX_TTL_MS = 5 * 60 * 1000;
const SEARCH_PREFIX_MAX_LENGTH = 32;
const SEARCH_FRAGMENT_LENGTH = 3;
const SEARCH_INDEX_MIN_QUERY_LENGTH = 2;
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
  namePrefixMap: new Map(),
  nameSquashedPrefixMap: new Map(),
  pinyinPrefixMap: new Map(),
  tokenMap: new Map(),
  fragmentMap: new Map(),
  updatedAt: 0,
  refreshPromise: null,
};

const iconState = {
  cache: new Map(),
  inFlight: new Map(),
  cacheDirPath: "",
  cacheDirReady: false,
  cacheDirPromise: null,
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

function addSearchIndexBucket(indexMap, key, item) {
  const normalizedKey = String(key ?? "").trim();
  if (!normalizedKey) {
    return;
  }

  const existing = indexMap.get(normalizedKey);
  if (existing) {
    existing.push(item);
    return;
  }
  indexMap.set(normalizedKey, [item]);
}

function buildPrefixKeys(value) {
  const normalizedValue = String(value ?? "").trim();
  if (!normalizedValue) {
    return [];
  }

  const output = [];
  let previous = "";
  const maxLength = Math.min(SEARCH_PREFIX_MAX_LENGTH, normalizedValue.length);
  for (let i = 1; i <= maxLength; i += 1) {
    const prefix = normalizedValue.slice(0, i).trim();
    if (!prefix || prefix === previous) {
      continue;
    }
    output.push(prefix);
    previous = prefix;
  }
  return output;
}

function buildTokenSet(parts) {
  const output = [];
  const seen = new Set();

  for (let i = 0; i < parts.length; i += 1) {
    const tokens = tokenize(parts[i]);
    for (let j = 0; j < tokens.length; j += 1) {
      const token = tokens[j];
      if (!token || seen.has(token)) {
        continue;
      }
      seen.add(token);
      output.push(token);
    }
  }

  return output;
}

function buildSearchFragments(tokens) {
  const output = [];
  const seen = new Set();

  for (let i = 0; i < tokens.length; i += 1) {
    const token = String(tokens[i] ?? "").trim();
    if (!token) {
      continue;
    }
    if (token.length <= SEARCH_FRAGMENT_LENGTH) {
      if (!seen.has(token)) {
        seen.add(token);
        output.push(token);
      }
      continue;
    }
    for (let cursor = 0; cursor <= token.length - SEARCH_FRAGMENT_LENGTH; cursor += 1) {
      const fragment = token.slice(cursor, cursor + SEARCH_FRAGMENT_LENGTH);
      if (!fragment || seen.has(fragment)) {
        continue;
      }
      seen.add(fragment);
      output.push(fragment);
    }
  }

  return output;
}

function buildIndexedSearchEntry(item) {
  const normalizedName = normalizeText(item.name);
  const normalizedSearchText = normalizeText(item.searchText);
  const nameSquashed = normalizedName.replace(/\s+/g, "");
  const searchTextSquashed = normalizedSearchText.replace(/\s+/g, "");
  const searchTokens = buildTokenSet([item.name, ...(item.keywords || [])]);
  return {
    ...item,
    normalizedName,
    normalizedSearchText,
    nameSquashed,
    searchTextSquashed,
    searchTokens,
    searchFragments: buildSearchFragments(searchTokens),
    sortName: String(item.name ?? ""),
  };
}

function buildSearchLookupState(items) {
  const nextState = {
    byId: new Map(),
    namePrefixMap: new Map(),
    nameSquashedPrefixMap: new Map(),
    pinyinPrefixMap: new Map(),
    tokenMap: new Map(),
    fragmentMap: new Map(),
  };

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    nextState.byId.set(item.id, item);

    const namePrefixes = buildPrefixKeys(item.normalizedName);
    for (let j = 0; j < namePrefixes.length; j += 1) {
      addSearchIndexBucket(nextState.namePrefixMap, namePrefixes[j], item);
    }

    const squashedPrefixes = buildPrefixKeys(item.nameSquashed);
    for (let j = 0; j < squashedPrefixes.length; j += 1) {
      addSearchIndexBucket(nextState.nameSquashedPrefixMap, squashedPrefixes[j], item);
    }

    const pinyinPrefixes = buildPrefixKeys(item.pinyinInitials);
    for (let j = 0; j < pinyinPrefixes.length; j += 1) {
      addSearchIndexBucket(nextState.pinyinPrefixMap, pinyinPrefixes[j], item);
    }

    for (let j = 0; j < item.searchTokens.length; j += 1) {
      addSearchIndexBucket(nextState.tokenMap, item.searchTokens[j], item);
    }

    for (let j = 0; j < item.searchFragments.length; j += 1) {
      addSearchIndexBucket(nextState.fragmentMap, item.searchFragments[j], item);
    }
  }

  return nextState;
}

function addSearchCandidates(candidateSet, indexMap, key) {
  const normalizedKey = String(key ?? "").trim();
  if (!normalizedKey) {
    return;
  }

  const matches = indexMap.get(normalizedKey);
  if (!matches || matches.length === 0) {
    return;
  }

  for (let i = 0; i < matches.length; i += 1) {
    candidateSet.add(matches[i]);
  }
}

function collectIndexedSearchCandidates(normalizedQuery, querySquashed, queryTokens) {
  const candidates = new Set();

  if (normalizedQuery.length >= SEARCH_INDEX_MIN_QUERY_LENGTH) {
    addSearchCandidates(candidates, indexState.namePrefixMap, normalizedQuery);
  }
  if (querySquashed.length >= SEARCH_INDEX_MIN_QUERY_LENGTH) {
    addSearchCandidates(candidates, indexState.nameSquashedPrefixMap, querySquashed);
    addSearchCandidates(candidates, indexState.pinyinPrefixMap, querySquashed);
  }

  for (let i = 0; i < queryTokens.length; i += 1) {
    const token = queryTokens[i];
    if (!token) {
      continue;
    }
    addSearchCandidates(candidates, indexState.tokenMap, token);
    addSearchCandidates(candidates, indexState.namePrefixMap, token);
    if (token.length >= SEARCH_FRAGMENT_LENGTH) {
      addSearchCandidates(
        candidates,
        indexState.fragmentMap,
        token.slice(0, SEARCH_FRAGMENT_LENGTH),
      );
    }
  }

  if (candidates.size === 0) {
    return null;
  }
  return Array.from(candidates);
}

function shouldUseIndexedSearchPool(candidates, limit, normalizedQuery, queryTokens) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return false;
  }
  if (normalizedQuery.length < SEARCH_INDEX_MIN_QUERY_LENGTH) {
    return false;
  }
  if (candidates.length >= limit) {
    return true;
  }
  return queryTokens.length > 0 && queryTokens.every((token) => token.length >= SEARCH_FRAGMENT_LENGTH);
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

function isLikelyUwpAppId(appId) {
  return String(appId ?? "").includes("!");
}

function extractAbsolutePathFromAppId(appId) {
  const text = String(appId ?? "").trim();
  const direct = normalizeAbsolutePathCandidate(text);
  if (direct) {
    return direct;
  }

  const match = text.match(/[A-Za-z]:\\[^<>:"|?*\r\n]+/);
  if (!match) {
    return null;
  }
  return normalizeAbsolutePathCandidate(match[0]);
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
      "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8",
      "$OutputEncoding=[Console]::OutputEncoding",
      `$json=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))`,
      "$items=$json|ConvertFrom-Json",
      "if($items -isnot [System.Array]){$items=@($items)}",
      "$shell=New-Object -ComObject WScript.Shell",
      "$rows=@()",
      "foreach($item in $items){",
      "  try{",
      "    $shortcut=$shell.CreateShortcut([string]$item)",
      "    $rows+=[pscustomobject]@{shortcutPath=[string]$item;targetPath=[string]$shortcut.TargetPath;iconLocation=[string]$shortcut.IconLocation}",
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
          encoding: "utf8",
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
      const lookupKey = item.launchTarget.toLowerCase();
      const row = shortcutByPath.get(lookupKey);
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
      "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8",
      "$OutputEncoding=[Console]::OutputEncoding",
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
      "  $candidates=Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue | Where-Object { $_.BaseName -like ($name + '*') -and $_.Extension -eq $ext } | Sort-Object Name",
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
      "    $logoCandidates=@([string]$appNode.GetAttribute('Square44x44Logo'),[string]$appNode.GetAttribute('Square150x150Logo'),[string]$appNode.GetAttribute('Logo'))",
      "    foreach($child in $appNode.ChildNodes){",
      "      if($child.LocalName -ne 'VisualElements'){continue}",
      "      $logoCandidates += @([string]$child.GetAttribute('Square44x44Logo'),[string]$child.GetAttribute('Square150x150Logo'),[string]$child.GetAttribute('Logo'))",
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
          encoding: "utf8",
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
    .filter((item) => item.launchType === "uwp" && isLikelyUwpAppId(item.launchTarget))
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
  const command = [
    "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8",
    "$OutputEncoding=[Console]::OutputEncoding",
    "Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress",
  ].join(";");
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      {
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
        encoding: "utf8",
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
      const launchPath = extractAbsolutePathFromAppId(appId);
      const launchType = launchPath ? "path" : "uwp";
      const launchTarget = launchPath || appId;
      const source = launchPath ? "Start Menu" : "UWP";
      const id = `${launchType}:${launchTarget.toLowerCase()}`;
      output.push({
        id,
        name,
        source,
        launchType,
        launchTarget,
        launchArgs: [],
        iconPath: launchPath,
        keywords: [],
        matchBoost: 0,
        searchText: makeSearchText(name, launchTarget, [], source),
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
  if (item.launchType === "internal") {
    return `internal:${String(item.id ?? "").trim().toLowerCase()}`;
  }
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
    indexState.namePrefixMap = new Map();
    indexState.nameSquashedPrefixMap = new Map();
    indexState.pinyinPrefixMap = new Map();
    indexState.tokenMap = new Map();
    indexState.fragmentMap = new Map();
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
    const merged = dedupeByName(mergedByLaunch).map((item) => buildIndexedSearchEntry(item));
    const lookupState = buildSearchLookupState(merged);
    indexState.items = merged;
    indexState.byId = lookupState.byId;
    indexState.namePrefixMap = lookupState.namePrefixMap;
    indexState.nameSquashedPrefixMap = lookupState.nameSquashedPrefixMap;
    indexState.pinyinPrefixMap = lookupState.pinyinPrefixMap;
    indexState.tokenMap = lookupState.tokenMap;
    indexState.fragmentMap = lookupState.fragmentMap;
    indexState.updatedAt = Date.now();
    return merged.length;
  })()
    .finally(() => {
      indexState.refreshPromise = null;
    });

  return indexState.refreshPromise;
}

async function ensureIndexReady() {
  if (indexState.items.length === 0) {
    await refreshSystemAppsIndex();
    return;
  }

  const isStale = Date.now() - indexState.updatedAt > INDEX_TTL_MS;
  if (isStale && !indexState.refreshPromise) {
    void refreshSystemAppsIndex().catch(() => {
      // Keep serving the current in-memory index when background refresh fails.
    });
  }
}

function computeSearchScore(item, normalizedQuery, querySquashed, queryTokens) {
  if (!normalizedQuery || queryTokens.length === 0) {
    return -1;
  }

  const name = item.normalizedName;
  const text = item.normalizedSearchText;
  const nameSquashed = item.nameSquashed;
  const textSquashed = item.searchTextSquashed;
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
    const tokenSquashed = token;
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

function normalizeLookupIds(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  const output = [];
  const seen = new Set();
  for (let i = 0; i < input.length; i += 1) {
    const id = String(input[i] ?? "").trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    output.push(id);
    if (output.length >= LOOKUP_BY_ID_LIMIT) {
      break;
    }
  }
  return output;
}

function isScoredEntryBetter(left, right) {
  if (left.score !== right.score) {
    return left.score > right.score;
  }
  return left.item.sortName.localeCompare(right.item.sortName) < 0;
}

function pushTopSearchEntry(topEntries, nextEntry, limit) {
  if (topEntries.length >= limit && !isScoredEntryBetter(nextEntry, topEntries[topEntries.length - 1])) {
    return;
  }

  let insertAt = topEntries.length;
  for (let i = 0; i < topEntries.length; i += 1) {
    if (isScoredEntryBetter(nextEntry, topEntries[i])) {
      insertAt = i;
      break;
    }
  }

  topEntries.splice(insertAt, 0, nextEntry);
  if (topEntries.length > limit) {
    topEntries.length = limit;
  }
}

function resolveIconCacheDirPath() {
  if (iconState.cacheDirPath) {
    return iconState.cacheDirPath;
  }

  try {
    iconState.cacheDirPath = path.join(
      electronApp.getPath("userData"),
      ICON_CACHE_DIR_NAME,
    );
  } catch {
    iconState.cacheDirPath = path.join(process.cwd(), "data", ICON_CACHE_DIR_NAME);
  }
  return iconState.cacheDirPath;
}

async function ensureIconCacheDir() {
  if (iconState.cacheDirReady) {
    return true;
  }
  if (iconState.cacheDirPromise) {
    return iconState.cacheDirPromise;
  }

  const dirPath = resolveIconCacheDirPath();
  iconState.cacheDirPromise = fs.promises.mkdir(dirPath, { recursive: true })
    .then(() => {
      iconState.cacheDirReady = true;
      return true;
    })
    .catch(() => false)
    .finally(() => {
      iconState.cacheDirPromise = null;
    });
  return iconState.cacheDirPromise;
}

function getIconCacheFilePath(cacheKey) {
  const hash = crypto
    .createHash("sha1")
    .update(String(cacheKey ?? ""))
    .digest("hex");
  return path.join(resolveIconCacheDirPath(), `${hash}.json`);
}

function normalizeIconCacheMtime(input) {
  const numeric = Number(input);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return Math.floor(numeric);
}

function normalizeIconCacheTimestamp(input) {
  const numeric = Number(input);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return Math.floor(numeric);
}

function normalizePersistedIconCacheEntry(input) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const candidate = input;
  const version = Number(candidate.version ?? 0);
  if (version !== ICON_CACHE_FILE_VERSION) {
    return null;
  }

  const iconPath = String(candidate.iconPath ?? "").trim();
  const cachedAt = normalizeIconCacheTimestamp(candidate.cachedAt);
  const sourceMtimeMs = normalizeIconCacheMtime(candidate.sourceMtimeMs);
  const dataUrlInput = candidate.dataUrl;
  const dataUrl = typeof dataUrlInput === "string" && dataUrlInput.trim()
    ? dataUrlInput
    : null;

  if (!iconPath || cachedAt <= 0) {
    return null;
  }

  return {
    version: ICON_CACHE_FILE_VERSION,
    iconPath,
    cachedAt,
    sourceMtimeMs,
    dataUrl,
  };
}

function isIconCacheExpired(cachedAt) {
  if (!Number.isFinite(cachedAt) || cachedAt <= 0) {
    return true;
  }
  return Date.now() - cachedAt > ICON_CACHE_TTL_MS;
}

function updateMemoryIconCache(cacheKey, entry) {
  if (!entry) {
    iconState.cache.delete(cacheKey);
    return;
  }
  iconState.cache.set(cacheKey, {
    dataUrl: entry.dataUrl,
    cachedAt: entry.cachedAt,
    sourceMtimeMs: entry.sourceMtimeMs,
  });
}

async function readIconSourceMtimeMs(iconPath) {
  try {
    const stats = await fs.promises.stat(iconPath);
    return normalizeIconCacheMtime(stats.mtimeMs);
  } catch {
    return null;
  }
}

async function deleteIconCacheFile(cacheKey) {
  try {
    await fs.promises.unlink(getIconCacheFilePath(cacheKey));
  } catch {
    // Ignore missing or inaccessible cache files.
  }
}

async function readPersistedIconCache(cacheKey, iconPath) {
  const filePath = getIconCacheFilePath(cacheKey);
  let rawText = "";
  try {
    rawText = await fs.promises.readFile(filePath, "utf8");
  } catch {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    await deleteIconCacheFile(cacheKey);
    return null;
  }

  const normalized = normalizePersistedIconCacheEntry(parsed);
  if (!normalized) {
    await deleteIconCacheFile(cacheKey);
    return null;
  }
  if (normalized.iconPath !== iconPath) {
    await deleteIconCacheFile(cacheKey);
    return null;
  }
  if (isIconCacheExpired(normalized.cachedAt)) {
    await deleteIconCacheFile(cacheKey);
    return null;
  }

  const currentMtimeMs = await readIconSourceMtimeMs(iconPath);
  if (normalized.sourceMtimeMs !== currentMtimeMs) {
    await deleteIconCacheFile(cacheKey);
    return null;
  }

  updateMemoryIconCache(cacheKey, normalized);
  return {
    dataUrl: normalized.dataUrl,
  };
}

async function writePersistedIconCache(cacheKey, iconPath, dataUrl) {
  const cacheEnabled = await ensureIconCacheDir();
  const sourceMtimeMs = await readIconSourceMtimeMs(iconPath);
  const entry = {
    version: ICON_CACHE_FILE_VERSION,
    iconPath,
    cachedAt: Date.now(),
    sourceMtimeMs,
    dataUrl: typeof dataUrl === "string" && dataUrl ? dataUrl : null,
  };

  updateMemoryIconCache(cacheKey, entry);

  if (!cacheEnabled) {
    return entry.dataUrl;
  }

  const filePath = getIconCacheFilePath(cacheKey);
  const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.promises.writeFile(tempFilePath, JSON.stringify(entry), "utf8");
    await fs.promises.rename(tempFilePath, filePath);
  } catch {
    try {
      await fs.promises.unlink(tempFilePath);
    } catch {
      // Ignore temp cleanup failures.
    }
  }
  return entry.dataUrl;
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

  const normalizedIconPath = String(iconPath).trim();
  if (!normalizedIconPath) {
    return null;
  }

  const cacheKey = normalizedIconPath.toLowerCase();
  const memoryEntry = iconState.cache.get(cacheKey);
  if (memoryEntry && !isIconCacheExpired(memoryEntry.cachedAt)) {
    return memoryEntry.dataUrl;
  }
  if (memoryEntry) {
    iconState.cache.delete(cacheKey);
  }
  if (iconState.inFlight.has(cacheKey)) {
    return iconState.inFlight.get(cacheKey);
  }

  const promise = (async () => {
    try {
      const persistedCacheEntry = await readPersistedIconCache(cacheKey, normalizedIconPath);
      if (persistedCacheEntry) {
        return persistedCacheEntry.dataUrl;
      }

      const mimeType = getImageMimeTypeByPath(normalizedIconPath);
      let resolvedDataUrl = null;
      if (mimeType) {
        try {
          const fileBuffer = await fs.promises.readFile(normalizedIconPath);
          resolvedDataUrl = `data:${mimeType};base64,${fileBuffer.toString("base64")}`;
        } catch {
          // Fall through to getFileIcon for paths that are protected but shell-resolvable.
        }
      }

      if (!resolvedDataUrl) {
        const image = await electronApp.getFileIcon(normalizedIconPath, { size: "small" });
        if (image && !image.isEmpty()) {
          resolvedDataUrl = image.toDataURL();
        }
      }

      return writePersistedIconCache(cacheKey, normalizedIconPath, resolvedDataUrl);
    } catch {
      return writePersistedIconCache(cacheKey, normalizedIconPath, null);
    } finally {
      iconState.inFlight.delete(cacheKey);
    }
  })();

  iconState.inFlight.set(cacheKey, promise);
  return promise;
}

async function toPublicEntry(entry) {
  const iconPath = getIconLookupPath(entry);
  const inlineIconDataUrl = typeof entry.iconDataUrl === "string" && entry.iconDataUrl.trim()
    ? entry.iconDataUrl.trim()
    : "";
  const iconDataUrl = inlineIconDataUrl || await loadIconDataUrl(iconPath);
  return {
    id: entry.id,
    name: entry.name,
    source: entry.source,
    launchType: entry.launchType,
    category: entry.category,
    description: entry.description,
    acceptsLaunchPayload: supportsSystemAppLaunchPayload(entry),
    iconDataUrl: iconDataUrl || undefined,
  };
}

function toPublicEntryBase(entry) {
  return {
    id: entry.id,
    name: entry.name,
    source: entry.source,
    launchType: entry.launchType,
    category: entry.category,
    description: entry.description,
    acceptsLaunchPayload: supportsSystemAppLaunchPayload(entry),
    iconDataUrl:
      typeof entry.iconDataUrl === "string" && entry.iconDataUrl.trim()
        ? entry.iconDataUrl.trim()
        : undefined,
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
  const querySquashed = normalizedQuery.replace(/\s+/g, "");
  const limit = normalizeSearchLimit(limitInput);
  const indexedCandidates = collectIndexedSearchCandidates(
    normalizedQuery,
    querySquashed,
    queryTokens,
  );
  const searchPool = shouldUseIndexedSearchPool(
    indexedCandidates,
    limit,
    normalizedQuery,
    queryTokens,
  )
    ? indexedCandidates
    : indexState.items;

  const topEntries = [];
  for (let i = 0; i < searchPool.length; i += 1) {
    const item = searchPool[i];
    const score = computeSearchScore(item, normalizedQuery, querySquashed, queryTokens);
    if (score < 0) {
      continue;
    }
    pushTopSearchEntry(topEntries, { score, item }, limit);
  }

  return topEntries.map(({ item }) => toPublicEntryBase(item));
}

async function getSystemAppsByIds(appIdsInput) {
  if (!isWindowsRuntime()) {
    return [];
  }

  const appIds = normalizeLookupIds(appIdsInput);
  if (appIds.length === 0) {
    return [];
  }

  await ensureIndexReady();
  const matched = appIds
    .map((appId) => indexState.byId.get(appId))
    .filter(Boolean);

  if (matched.length === 0) {
    return [];
  }
  return Promise.all(matched.map((entry) => toPublicEntry(entry)));
}

async function listSystemApps() {
  if (!isWindowsRuntime()) {
    return [];
  }

  await ensureIndexReady();
  const allowedSystemAppIds = new Set([
    "builtin:ai-chat",
    "builtin:screen-recorder",
  ]);
  const builtinEntries = indexState.items.filter(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      allowedSystemAppIds.has(String(entry.id ?? "").trim()),
  );

  if (builtinEntries.length === 0) {
    return [];
  }

  builtinEntries.sort((a, b) => {
    const categoryA = String(a.category ?? "").trim();
    const categoryB = String(b.category ?? "").trim();
    if (categoryA !== categoryB) {
      return categoryA.localeCompare(categoryB);
    }
    return String(a.name ?? "").localeCompare(String(b.name ?? ""));
  });

  return Promise.all(builtinEntries.map((entry) => toPublicEntry(entry)));
}

function normalizeLaunchPayload(input) {
  if (input === undefined || input === null) {
    return null;
  }
  const text = String(input).trim();
  return text ? text : null;
}

function supportsSystemAppLaunchPayload(entry) {
  if (!entry) {
    return false;
  }
  if (entry.acceptsLaunchPayload === true) {
    return true;
  }
  if (entry.launchType !== "command") {
    return false;
  }
  return String(entry.id || "").startsWith("builtin:");
}

function buildCommandLaunchArgs(entry, launchPayload) {
  const baseArgs = Array.isArray(entry.launchArgs) ? [...entry.launchArgs] : [];
  if (!launchPayload) {
    return baseArgs;
  }

  if (entry.id === "builtin:command-prompt") {
    return ["/K", launchPayload];
  }
  if (entry.id === "builtin:powershell") {
    return ["-NoExit", "-Command", launchPayload];
  }
  if (entry.id === "builtin:windows-settings") {
    const normalizedPayload = launchPayload.toLowerCase().startsWith("ms-settings:")
      ? launchPayload
      : `ms-settings:${launchPayload}`;
    return [normalizedPayload];
  }
  return [...baseArgs, launchPayload];
}

async function openSystemApp(appIdInput, launchPayloadInput) {
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
  const launchPayload = normalizeLaunchPayload(launchPayloadInput);

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
    const commandArgs = buildCommandLaunchArgs(appEntry, launchPayload);
    await new Promise((resolve, reject) => {
      const child = spawn(
        appEntry.launchTarget,
        commandArgs,
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

  if (appEntry.launchType === "internal") {
    throw new Error(`Internal system app requires host handling: ${appEntry.id}`);
  }

  throw new Error(`Unsupported launch type: ${appEntry.launchType}`);
}

module.exports = {
  getSystemAppsByIds,
  listSystemApps,
  openSystemApp,
  refreshSystemAppsIndex,
  searchSystemApps,
};
