const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");

const DEFAULT_TABS = [
  { id: "workspace", label: "工作区" },
  { id: "projects", label: "项目" },
  { id: "automation", label: "自动化" },
  { id: "monitoring", label: "监控" },
  { id: "security", label: "安全" },
];

let dbPromise = null;

function resolveDatabasePath() {
  if (!app.isPackaged) {
    return path.join(process.cwd(), "data", "settings.sqlite");
  }
  return path.join(app.getPath("userData"), "settings.sqlite");
}

async function getDb() {
  if (!dbPromise) {
    dbPromise = initDb();
  }
  return dbPromise;
}

async function initDb() {
  const dbPath = resolveDatabasePath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS settings_tabs (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS app_generator_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  const row = await db.get("SELECT COUNT(1) AS count FROM settings_tabs");
  if (!row || row.count === 0) {
    await writeTabs(db, DEFAULT_TABS);
  }

  return db;
}

async function getGeneratorSettingValue(db, key, fallback = "") {
  const row = await db.get(
    "SELECT value FROM app_generator_settings WHERE key = ?",
    key,
  );
  if (!row) {
    return fallback;
  }
  return String(row.value ?? fallback);
}

async function setGeneratorSettingValue(db, key, value) {
  await db.run(
    `INSERT INTO app_generator_settings(key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
    key,
    value,
    Date.now(),
  );
}

function normalizeTabId(value, fallback) {
  const source = String(value ?? fallback ?? "").trim().toLowerCase();
  const normalized = source
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || `tab-${Date.now().toString(36)}`;
}

function normalizeTabs(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  const seen = new Set();
  const tabs = [];

  for (let i = 0; i < input.length; i += 1) {
    const item = input[i] ?? {};
    const label = String(item.label ?? "").trim();
    if (!label) {
      continue;
    }

    const id = normalizeTabId(item.id, label);
    if (seen.has(id)) {
      continue;
    }

    seen.add(id);
    tabs.push({ id, label });
  }

  return tabs;
}

async function writeTabs(db, tabs) {
  await db.exec("BEGIN");
  try {
    await db.run("DELETE FROM settings_tabs");
    for (let i = 0; i < tabs.length; i += 1) {
      const tab = tabs[i];
      await db.run(
        "INSERT INTO settings_tabs(id, label, sort_order) VALUES (?, ?, ?)",
        tab.id,
        tab.label,
        i,
      );
    }
    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

async function getSettingsTabs() {
  const db = await getDb();
  const rows = await db.all(
    "SELECT id, label FROM settings_tabs ORDER BY sort_order ASC, id ASC",
  );
  return rows.map((row) => ({ id: String(row.id), label: String(row.label) }));
}

async function saveSettingsTabs(tabsInput) {
  const tabs = normalizeTabs(tabsInput);
  if (tabs.length === 0) {
    throw new Error("At least one valid tab is required.");
  }

  const db = await getDb();
  await writeTabs(db, tabs);
  return getSettingsTabs();
}

async function initializeSettingsStore() {
  await getDb();
  return getSettingsTabs();
}

async function closeSettingsStore() {
  if (!dbPromise) {
    return false;
  }

  const activePromise = dbPromise;
  dbPromise = null;
  const db = await activePromise;
  await db.close();
  return true;
}

async function getGeneratorSettings() {
  const db = await getDb();
  const claudeCliPath = await getGeneratorSettingValue(db, "claude_cli_path", "");
  return { claudeCliPath };
}

async function saveGeneratorSettings(input) {
  const claudeCliPath = String(input?.claudeCliPath ?? "").trim();
  const db = await getDb();
  await setGeneratorSettingValue(db, "claude_cli_path", claudeCliPath);
  return { claudeCliPath };
}

module.exports = {
  closeSettingsStore,
  getGeneratorSettings,
  getSettingsTabs,
  initializeSettingsStore,
  saveSettingsTabs,
  saveGeneratorSettings,
  resolveDatabasePath,
};
