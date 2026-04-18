// @ts-nocheck
const { applySqliteMigrations, tableHasColumn } = require("./sqlite-migrations");

const APPS_STORE_MIGRATION_TABLE = "tool_hub_schema_migrations";

const appsStoreMigrations = [
  {
    id: "apps-store:001:create-apps",
    async up(db) {
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
          capabilities_json TEXT NOT NULL DEFAULT '[]',
          auto_start INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL
        );
      `);
    },
  },
  {
    id: "apps-store:002:add-apps-tab-id",
    async up(db) {
      if (await tableHasColumn(db, "apps", "tab_id")) {
        return;
      }
      await db.exec("ALTER TABLE apps ADD COLUMN tab_id TEXT NOT NULL DEFAULT 'workspace';");
    },
  },
  {
    id: "apps-store:003:add-apps-capabilities-json",
    async up(db) {
      if (await tableHasColumn(db, "apps", "capabilities_json")) {
        return;
      }
      await db.exec("ALTER TABLE apps ADD COLUMN capabilities_json TEXT NOT NULL DEFAULT '[]';");
    },
  },
  {
    id: "apps-store:004:add-apps-auto-start",
    async up(db) {
      if (await tableHasColumn(db, "apps", "auto_start")) {
        return;
      }
      await db.exec("ALTER TABLE apps ADD COLUMN auto_start INTEGER NOT NULL DEFAULT 0;");
    },
  },
  {
    id: "apps-store:005:create-app-runs",
    async up(db) {
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
    },
  },
  {
    id: "apps-store:006:create-app-kv",
    async up(db) {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS app_kv (
          app_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (app_id, key),
          FOREIGN KEY(app_id) REFERENCES apps(id)
        );
      `);
    },
  },
];

async function applyAppsStoreMigrations(db) {
  await applySqliteMigrations(db, appsStoreMigrations, {
    tableName: APPS_STORE_MIGRATION_TABLE,
  });
}

module.exports = {
  applyAppsStoreMigrations,
};
