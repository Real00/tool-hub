const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const { app } = require("electron");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");

const TOOL_HUB_ROOT_DIR = ".tool-hub";
const APPS_DIR_NAME = "apps";
const DB_FILE_NAME = "apps.sqlite";
const MAX_LOG_LINES = 400;
const LIST_ROWS_CACHE_TTL_MS = 1200;
const SCAN_REFRESH_INTERVAL_MS = 5000;

let dbPromise = null;

const runningApps = new Map();
const appLogs = new Map();
const manifestCacheByFolder = new Map();
let appsRowsCache = null;
let scanInFlight = null;
let lastScanAt = 0;
let hasCompletedInitialScan = false;

function resolveToolHubRoot() {
  return path.join(app.getPath("home"), TOOL_HUB_ROOT_DIR);
}

function resolveAppsRoot() {
  return path.join(resolveToolHubRoot(), APPS_DIR_NAME);
}

function resolveAppsDbPath() {
  return path.join(resolveToolHubRoot(), DB_FILE_NAME);
}

function ensureDirs() {
  fs.mkdirSync(resolveAppsRoot(), { recursive: true });
}

async function getDb() {
  if (!dbPromise) {
    dbPromise = initDb();
  }
  return dbPromise;
}

async function initDb() {
  ensureDirs();
  const db = await open({
    filename: resolveAppsDbPath(),
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      tab_id TEXT NOT NULL DEFAULT 'workspace',
      app_dir TEXT NOT NULL,
      entry_rel TEXT NOT NULL,
      ui_kind TEXT,
      ui_value TEXT,
      env_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  const columns = await db.all("PRAGMA table_info(apps)");
  const hasTabId = columns.some((col) => col.name === "tab_id");
  if (!hasTabId) {
    await db.exec("ALTER TABLE apps ADD COLUMN tab_id TEXT NOT NULL DEFAULT 'workspace';");
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS app_runs (
      run_id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id TEXT NOT NULL,
      pid INTEGER,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      exit_code INTEGER,
      FOREIGN KEY(app_id) REFERENCES apps(id)
    );
  `);

  return db;
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

function normalizeAppId(value, fallback) {
  const source = String(value ?? fallback ?? "").trim().toLowerCase();
  const normalized = source
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized;
}

function normalizeTabId(value, fallback) {
  const source = String(value ?? fallback ?? "").trim().toLowerCase();
  const normalized = source
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) {
    return "workspace";
  }
  return normalized;
}

async function readManifest(appDir) {
  const manifestPath = path.join(appDir, "app.json");
  try {
    const content = await fs.promises.readFile(manifestPath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return null;
    }
    return { __parseError: String(error) };
  }
}

async function getManifestMtimeMs(appDir) {
  const manifestPath = path.join(appDir, "app.json");
  try {
    const stat = await fs.promises.stat(manifestPath);
    if (!stat.isFile()) {
      return null;
    }
    return stat.mtimeMs;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function shouldRefreshAppsScan(force = false) {
  if (force) {
    return true;
  }
  if (!hasCompletedInitialScan) {
    return true;
  }
  return Date.now() - lastScanAt >= SCAN_REFRESH_INTERVAL_MS;
}

function invalidateAppsRowsCache() {
  appsRowsCache = null;
}

function cloneRows(rows) {
  return rows.map((row) => ({ ...row }));
}

async function loadAppsRows(options = {}) {
  const force = options.force === true;
  const now = Date.now();
  if (
    !force &&
    appsRowsCache &&
    now - appsRowsCache.updatedAt <= LIST_ROWS_CACHE_TTL_MS
  ) {
    return cloneRows(appsRowsCache.rows);
  }

  const db = await getDb();
  const rows = await db.all(
    "SELECT id, name, version, tab_id, app_dir, entry_rel, ui_kind, ui_value, env_json FROM apps ORDER BY name ASC",
  );
  appsRowsCache = {
    rows: cloneRows(rows),
    updatedAt: now,
  };
  return cloneRows(rows);
}

async function rowsToViews(rows) {
  const views = [];
  for (const row of rows) {
    views.push(await toAppView(row));
  }
  return views;
}

function parseUi(manifest) {
  if (typeof manifest.uiUrl === "string" && manifest.uiUrl.trim()) {
    return { uiKind: "url", uiValue: manifest.uiUrl.trim() };
  }

  if (typeof manifest.uiPath === "string" && manifest.uiPath.trim()) {
    return { uiKind: "file", uiValue: manifest.uiPath.trim() };
  }

  if (typeof manifest.ui === "string" && manifest.ui.trim()) {
    const value = manifest.ui.trim();
    if (isHttpUrl(value)) {
      return { uiKind: "url", uiValue: value };
    }
    return { uiKind: "file", uiValue: value };
  }

  return { uiKind: null, uiValue: null };
}

function parseManifestRecord(appDir, folderName, manifest) {
  if (!manifest || typeof manifest !== "object") {
    return null;
  }
  if (manifest.__parseError) {
    return null;
  }

  const id = normalizeAppId(manifest.id, folderName);
  const name = String(manifest.name ?? folderName).trim();
  const version = String(manifest.version ?? "0.0.0").trim();
  const entryRel = String(manifest.entry ?? "index.js").trim();
  const env = manifest.env && typeof manifest.env === "object" ? manifest.env : {};
  const { uiKind, uiValue } = parseUi(manifest);

  if (!id || !name || !entryRel) {
    return null;
  }

  return {
    id,
    name,
    version,
    appDir,
    entryRel,
    uiKind,
    uiValue,
    envJson: JSON.stringify(env),
  };
}

async function scanAppsIncrementally() {
  ensureDirs();
  const appsRoot = resolveAppsRoot();
  const entries = await fs.promises.readdir(appsRoot, { withFileTypes: true });
  const folderEntries = entries
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
  const liveFolders = new Set(folderEntries.map((entry) => entry.name));

  for (const cachedFolder of manifestCacheByFolder.keys()) {
    if (!liveFolders.has(cachedFolder)) {
      manifestCacheByFolder.delete(cachedFolder);
    }
  }

  const discovered = [];
  const seen = new Set();

  for (const entry of folderEntries) {
    const folderName = entry.name;
    const appDir = path.join(appsRoot, folderName);
    const manifestMtimeMs = await getManifestMtimeMs(appDir);
    const cached = manifestCacheByFolder.get(folderName);

    let cachedRecord = null;
    if (
      cached &&
      cached.manifestMtimeMs === manifestMtimeMs &&
      cached.appDir === appDir
    ) {
      cachedRecord = cached.record;
    } else {
      const manifest = await readManifest(appDir);
      cachedRecord = parseManifestRecord(appDir, folderName, manifest);
      manifestCacheByFolder.set(folderName, {
        appDir,
        manifestMtimeMs,
        record: cachedRecord,
      });
    }

    if (!cachedRecord || seen.has(cachedRecord.id)) {
      continue;
    }
    seen.add(cachedRecord.id);
    discovered.push(cachedRecord);
  }

  return discovered;
}

function hasAppRecordChanged(existing, incoming, tabId) {
  if (!existing) {
    return true;
  }
  return (
    existing.name !== incoming.name ||
    existing.version !== incoming.version ||
    existing.tab_id !== tabId ||
    existing.app_dir !== incoming.appDir ||
    existing.entry_rel !== incoming.entryRel ||
    (existing.ui_kind ?? null) !== (incoming.uiKind ?? null) ||
    (existing.ui_value ?? null) !== (incoming.uiValue ?? null) ||
    existing.env_json !== incoming.envJson
  );
}

async function syncDiscoveredApps(discovered) {
  const db = await getDb();
  const existingRows = await db.all(
    "SELECT id, name, version, tab_id, app_dir, entry_rel, ui_kind, ui_value, env_json FROM apps",
  );
  const existingById = new Map(existingRows.map((row) => [row.id, row]));

  let changed = false;
  await db.exec("BEGIN");
  try {
    const now = Date.now();
    const discoveredIds = new Set(discovered.map((item) => item.id));

    for (const row of existingRows) {
      if (!discoveredIds.has(row.id)) {
        changed = true;
        await db.run("DELETE FROM apps WHERE id = ?", row.id);
      }
    }

    for (const item of discovered) {
      const existing = existingById.get(item.id);
      const persistedTabId = existing
        ? normalizeTabId(existing.tab_id, "workspace")
        : "workspace";
      if (!hasAppRecordChanged(existing, item, persistedTabId)) {
        continue;
      }

      changed = true;
      await db.run(
        `INSERT INTO apps(id, name, version, tab_id, app_dir, entry_rel, ui_kind, ui_value, env_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           version = excluded.version,
           app_dir = excluded.app_dir,
           entry_rel = excluded.entry_rel,
           ui_kind = excluded.ui_kind,
           ui_value = excluded.ui_value,
           env_json = excluded.env_json,
           updated_at = excluded.updated_at`,
        item.id,
        item.name,
        item.version,
        persistedTabId,
        item.appDir,
        item.entryRel,
        item.uiKind,
        item.uiValue,
        item.envJson,
        now,
      );
    }

    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }

  if (changed) {
    invalidateAppsRowsCache();
  }
  return changed;
}

async function scanAndSyncApps(options = {}) {
  const force = options.force === true;
  const background = options.background === true;
  if (!force && !shouldRefreshAppsScan(false)) {
    return;
  }
  if (scanInFlight) {
    return scanInFlight;
  }

  scanInFlight = (async () => {
    const discovered = await scanAppsIncrementally();
    await syncDiscoveredApps(discovered);
    lastScanAt = Date.now();
    hasCompletedInitialScan = true;
  })();

  if (background) {
    void scanInFlight.catch((error) => {
      console.error("Apps scan failed:", error);
    });
  }

  try {
    await scanInFlight;
  } finally {
    scanInFlight = null;
  }
}

function appendLog(appId, stream, text) {
  const lines = appLogs.get(appId) ?? [];
  lines.push({
    time: Date.now(),
    stream,
    text: String(text),
  });
  if (lines.length > MAX_LOG_LINES) {
    lines.splice(0, lines.length - MAX_LOG_LINES);
  }
  appLogs.set(appId, lines);
}

function toUiUrl(record) {
  if (!record.ui_kind || !record.ui_value) {
    return null;
  }
  if (record.ui_kind === "url") {
    return record.ui_value;
  }

  return pathToFileURL(path.join(record.app_dir, record.ui_value)).toString();
}

async function toAppView(record) {
  const runtime = runningApps.get(record.id);
  return {
    id: record.id,
    name: record.name,
    version: record.version,
    tabId: record.tab_id,
    appDir: record.app_dir,
    entryRel: record.entry_rel,
    uiUrl: toUiUrl(record),
    running: !!runtime,
    pid: runtime?.pid ?? null,
  };
}

async function listApps() {
  const rows = await loadAppsRows();
  if (shouldRefreshAppsScan(false)) {
    void scanAndSyncApps({ background: true });
  }
  return rowsToViews(rows);
}

async function getAppRecord(appId) {
  const db = await getDb();
  return db.get(
    "SELECT id, name, version, tab_id, app_dir, entry_rel, ui_kind, ui_value, env_json FROM apps WHERE id = ?",
    appId,
  );
}

async function getAppRecordFresh(appId) {
  await scanAndSyncApps({ force: true });
  const db = await getDb();
  return db.get(
    "SELECT id, name, version, tab_id, app_dir, entry_rel, ui_kind, ui_value, env_json FROM apps WHERE id = ?",
    appId,
  );
}

async function getAppById(appId) {
  const record = await getAppRecordFresh(appId);
  if (!record) {
    return null;
  }
  return toAppView(record);
}

async function insertRun(appId, pid) {
  const db = await getDb();
  const result = await db.run(
    "INSERT INTO app_runs(app_id, pid, status, started_at) VALUES (?, ?, ?, ?)",
    appId,
    pid,
    "running",
    Date.now(),
  );
  return result.lastID;
}

async function finishRun(runId, exitCode) {
  const db = await getDb();
  await db.run(
    "UPDATE app_runs SET status = ?, ended_at = ?, exit_code = ? WHERE run_id = ?",
    "stopped",
    Date.now(),
    Number.isInteger(exitCode) ? exitCode : null,
    runId,
  );
}

async function startApp(appId) {
  if (runningApps.has(appId)) {
    return listApps();
  }

  const record = await getAppRecord(appId);
  if (!record) {
    throw new Error(`App not found: ${appId}`);
  }

  const entryAbs = path.join(record.app_dir, record.entry_rel);
  if (!fs.existsSync(entryAbs)) {
    throw new Error(`Entry file not found: ${entryAbs}`);
  }

  const envFromManifest = (() => {
    try {
      const parsed = JSON.parse(record.env_json ?? "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  })();

  const child = spawn(process.execPath, ["--run-as-node", entryAbs], {
    cwd: record.app_dir,
    env: { ...process.env, ...envFromManifest },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const runId = await insertRun(appId, child.pid ?? null);
  runningApps.set(appId, { child, pid: child.pid ?? null, runId });
  appLogs.set(appId, []);

  child.stdout?.on("data", (chunk) => appendLog(appId, "stdout", chunk));
  child.stderr?.on("data", (chunk) => appendLog(appId, "stderr", chunk));
  child.on("exit", (code) => {
    void finishRun(runId, code);
    runningApps.delete(appId);
  });
  child.on("error", (error) => {
    appendLog(appId, "stderr", error.message);
  });

  return listApps();
}

async function stopApp(appId) {
  const runtime = runningApps.get(appId);
  if (runtime) {
    runtime.child.kill();
  }
  return listApps();
}

function getAppLogs(appId) {
  const lines = appLogs.get(appId) ?? [];
  return lines.map((line) => `[${new Date(line.time).toISOString()}] [${line.stream}] ${line.text}`);
}

async function setAppTab(appId, tabId) {
  const db = await getDb();
  await db.run("UPDATE apps SET tab_id = ?, updated_at = ? WHERE id = ?", tabId, Date.now(), appId);
  invalidateAppsRowsCache();
}

async function initializeAppsDatabase() {
  ensureDirs();
  await getDb();
  await scanAndSyncApps({ force: true });
  return listApps();
}

async function removeApp(appIdInput) {
  const appId = normalizeAppId(appIdInput, "");
  if (!appId) {
    throw new Error("Invalid app id.");
  }

  const record = await getAppRecord(appId);
  if (!record) {
    throw new Error(`App not found: ${appId}`);
  }

  const runtime = runningApps.get(appId);
  if (runtime) {
    runtime.child.kill();
    runningApps.delete(appId);
  }
  appLogs.delete(appId);

  const appsRoot = path.resolve(resolveAppsRoot());
  const targetDir = path.resolve(record.app_dir);
  const relativePath = path.relative(appsRoot, targetDir);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Refusing to remove directory outside apps root.");
  }

  fs.rmSync(targetDir, { recursive: true, force: true });
  manifestCacheByFolder.delete(path.basename(targetDir));

  const db = await getDb();
  await db.exec("BEGIN");
  try {
    await db.run("DELETE FROM app_runs WHERE app_id = ?", appId);
    await db.run("DELETE FROM apps WHERE id = ?", appId);
    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }

  invalidateAppsRowsCache();
  return listApps();
}

async function installAppFromDirectory(sourceDir, requestedTabId) {
  const sourceAbs = path.resolve(String(sourceDir ?? ""));
  if (!fs.existsSync(sourceAbs) || !fs.statSync(sourceAbs).isDirectory()) {
    throw new Error("Source path must be an existing directory.");
  }

  const manifest = await readManifest(sourceAbs);
  if (!manifest || manifest.__parseError) {
    throw new Error("Source directory must contain a valid app.json.");
  }

  const appId = normalizeAppId(manifest.id, path.basename(sourceAbs));
  if (!appId) {
    throw new Error("app.json must provide a valid id.");
  }

  ensureDirs();
  const targetDir = path.join(resolveAppsRoot(), appId);
  if (fs.existsSync(targetDir)) {
    throw new Error(`Target app directory already exists: ${targetDir}`);
  }

  fs.cpSync(sourceAbs, targetDir, {
    recursive: true,
    force: false,
    errorOnExist: true,
  });

  const selectedTabId = normalizeTabId(requestedTabId ?? "workspace", "workspace");
  await scanAndSyncApps({ force: true });
  await setAppTab(appId, selectedTabId);

  return listApps();
}

async function initializeAppsManager() {
  ensureDirs();
  await getDb();
}

module.exports = {
  getAppById,
  getAppLogs,
  initializeAppsDatabase,
  initializeAppsManager,
  installAppFromDirectory,
  listApps,
  removeApp,
  resolveAppsRoot,
  resolveAppsDbPath,
  startApp,
  stopApp,
};
