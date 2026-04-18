// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");

const {
  DEFAULT_TABS,
  applySettingsStoreMigrations,
  seedDefaultSettingsTabs,
} = require("./settings-store-schema");

async function withTempDb(run) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tool-hub-settings-schema-"));
  const dbPath = path.join(tempDir, "settings.sqlite");
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

test("settings store migrations upgrade legacy ai_chat_messages schema", async () => {
  await withTempDb(async (db) => {
    await db.exec(`
      CREATE TABLE ai_chat_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE ai_chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL,
        error_message TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    await applySettingsStoreMigrations(db);

    const columns = await db.all("PRAGMA table_info(ai_chat_messages)");
    const columnNames = columns.map((row) => String(row.name));
    assert.ok(columnNames.includes("response_id"));
    assert.ok(columnNames.includes("attachments_json"));
  });
});

test("settings store default tab seed is idempotent", async () => {
  await withTempDb(async (db) => {
    await applySettingsStoreMigrations(db);
    await seedDefaultSettingsTabs(db);
    await seedDefaultSettingsTabs(db);

    const rows = await db.all(
      "SELECT id, label, sort_order FROM settings_tabs ORDER BY sort_order ASC",
    );
    assert.equal(rows.length, DEFAULT_TABS.length);
    assert.deepEqual(
      rows.map((row) => ({
        id: String(row.id),
        label: String(row.label),
      })),
      DEFAULT_TABS,
    );
  });
});
