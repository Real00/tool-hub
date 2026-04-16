const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");

const { applyAppsStoreMigrations } = require("./apps-store-schema.cjs");

async function withTempDb(run) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tool-hub-apps-schema-"));
  const dbPath = path.join(tempDir, "apps.sqlite");
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  try {
    await run(db);
  } finally {
    await db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test("apps store migrations upgrade legacy apps table and create support tables", async () => {
  await withTempDb(async (db) => {
    await db.exec(`
      CREATE TABLE apps (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        app_dir TEXT NOT NULL,
        entry_rel TEXT NOT NULL,
        ui_kind TEXT,
        ui_value TEXT,
        env_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    await applyAppsStoreMigrations(db);

    const appColumns = await db.all("PRAGMA table_info(apps)");
    const appColumnNames = appColumns.map((row) => String(row.name));
    assert.ok(appColumnNames.includes("tab_id"));
    assert.ok(appColumnNames.includes("capabilities_json"));
    assert.ok(appColumnNames.includes("auto_start"));

    const appRunsColumns = await db.all("PRAGMA table_info(app_runs)");
    const appKvColumns = await db.all("PRAGMA table_info(app_kv)");
    assert.ok(appRunsColumns.length > 0);
    assert.ok(appKvColumns.length > 0);
  });
});
