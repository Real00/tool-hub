// @ts-nocheck
const { applySqliteMigrations, tableHasColumn } = require("./sqlite-migrations");

const SETTINGS_STORE_MIGRATION_TABLE = "tool_hub_schema_migrations";
const DEFAULT_TABS = [
  { id: "workspace", label: "工作区" },
  { id: "projects", label: "项目" },
  { id: "automation", label: "自动化" },
  { id: "monitoring", label: "监控" },
  { id: "security", label: "安全" },
];

const settingsStoreMigrations = [
  {
    id: "settings-store:001:create-settings-tabs",
    async up(db) {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS settings_tabs (
          id TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          sort_order INTEGER NOT NULL
        );
      `);
    },
  },
  {
    id: "settings-store:002:create-app-generator-settings",
    async up(db) {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS app_generator_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
    },
  },
  {
    id: "settings-store:003:create-ai-chat-sessions",
    async up(db) {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS ai_chat_sessions (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
    },
  },
  {
    id: "settings-store:004:create-ai-chat-messages",
    async up(db) {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS ai_chat_messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          attachments_json TEXT,
          response_id TEXT,
          status TEXT NOT NULL,
          error_message TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY(session_id) REFERENCES ai_chat_sessions(id) ON DELETE CASCADE
        );
      `);
    },
  },
  {
    id: "settings-store:005:add-ai-chat-message-response-id",
    async up(db) {
      if (await tableHasColumn(db, "ai_chat_messages", "response_id")) {
        return;
      }
      await db.exec(`
        ALTER TABLE ai_chat_messages
        ADD COLUMN response_id TEXT
      `);
    },
  },
  {
    id: "settings-store:006:add-ai-chat-message-attachments-json",
    async up(db) {
      if (await tableHasColumn(db, "ai_chat_messages", "attachments_json")) {
        return;
      }
      await db.exec(`
        ALTER TABLE ai_chat_messages
        ADD COLUMN attachments_json TEXT
      `);
    },
  },
];

async function applySettingsStoreMigrations(db) {
  await applySqliteMigrations(db, settingsStoreMigrations, {
    tableName: SETTINGS_STORE_MIGRATION_TABLE,
  });
}

async function writeDefaultTabs(db, tabs = DEFAULT_TABS) {
  await db.exec("BEGIN");
  try {
    await db.run("DELETE FROM settings_tabs");
    for (let index = 0; index < tabs.length; index += 1) {
      const tab = tabs[index];
      await db.run(
        "INSERT INTO settings_tabs(id, label, sort_order) VALUES (?, ?, ?)",
        tab.id,
        tab.label,
        index,
      );
    }
    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

async function seedDefaultSettingsTabs(db) {
  const row = await db.get("SELECT COUNT(1) AS count FROM settings_tabs");
  if (!row || Number(row.count ?? 0) === 0) {
    await writeDefaultTabs(db, DEFAULT_TABS);
  }
}

module.exports = {
  DEFAULT_TABS,
  applySettingsStoreMigrations,
  seedDefaultSettingsTabs,
};
