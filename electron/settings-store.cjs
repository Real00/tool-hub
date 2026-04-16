const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { app } = require("electron");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const {
  DEFAULT_TABS,
  applySettingsStoreMigrations,
  seedDefaultSettingsTabs,
} = require("./db/settings-store-schema.cjs");

const DEFAULT_VERIFY_COMMAND = "node --check src/index.js";
const DEFAULT_QUICK_LAUNCHER_HOTKEY = "Alt+Space";
const DEFAULT_AI_CHAT_TITLE = "New Chat";
const DEFAULT_AI_CHAT_API_TYPE = "chat-completions";
const DEFAULT_AI_CHAT_PROVIDER = "openai-sdk";
const DEFAULT_AI_CHAT_DEBUG_ENABLED = false;

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
  await db.exec("PRAGMA foreign_keys = ON");
  await applySettingsStoreMigrations(db);
  await seedDefaultSettingsTabs(db);

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

function createId() {
  return crypto.randomUUID();
}

function normalizeAiChatTitle(input) {
  const value = String(input ?? "").trim();
  return value || DEFAULT_AI_CHAT_TITLE;
}

function normalizeAiChatMessageRole(input) {
  const value = String(input ?? "").trim().toLowerCase();
  if (value === "system" || value === "assistant" || value === "user") {
    return value;
  }
  return "user";
}

function normalizeAiChatMessageStatus(input) {
  const value = String(input ?? "").trim().toLowerCase();
  if (value === "streaming" || value === "error" || value === "complete") {
    return value;
  }
  return "complete";
}

function normalizeAiChatApiType(input) {
  const value = String(input ?? "").trim().toLowerCase();
  if (value === "responses") {
    return "responses";
  }
  return DEFAULT_AI_CHAT_API_TYPE;
}

function normalizeAiChatProvider(input) {
  const value = String(input ?? "").trim().toLowerCase();
  if (value === "anthropic-sdk") {
    return "anthropic-sdk";
  }
  return DEFAULT_AI_CHAT_PROVIDER;
}

function mapAiChatSessionRow(row) {
  return {
    id: String(row.id),
    title: normalizeAiChatTitle(row.title),
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  };
}

function mapAiChatMessageRow(row) {
  let attachments = [];
  try {
    const parsed = JSON.parse(String(row.attachments_json ?? "[]"));
    if (Array.isArray(parsed)) {
      attachments = parsed
        .filter((item) => item && typeof item === "object")
        .map((item) => ({
          id: String(item.id ?? "").trim(),
          dataUrl: String(item.dataUrl ?? "").trim(),
          mimeType: String(item.mimeType ?? "").trim(),
        }))
        .filter((item) => item.id && item.dataUrl && item.mimeType);
    }
  } catch {
    attachments = [];
  }
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    role: normalizeAiChatMessageRole(row.role),
    content: String(row.content ?? ""),
    attachments,
    responseId:
      row.response_id === null || row.response_id === undefined
        ? null
        : String(row.response_id),
    status: normalizeAiChatMessageStatus(row.status),
    errorMessage:
      row.error_message === null || row.error_message === undefined
        ? null
        : String(row.error_message),
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  };
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
  const verifyCommand = await getGeneratorSettingValue(
    db,
    "generator_verify_command",
    DEFAULT_VERIFY_COMMAND,
  );
  return {
    claudeCliPath,
    verifyCommand: String(verifyCommand ?? DEFAULT_VERIFY_COMMAND).trim() || DEFAULT_VERIFY_COMMAND,
  };
}

async function saveGeneratorSettings(input) {
  const claudeCliPath = String(input?.claudeCliPath ?? "").trim();
  const verifyCommand =
    String(input?.verifyCommand ?? DEFAULT_VERIFY_COMMAND).trim() ||
    DEFAULT_VERIFY_COMMAND;
  const db = await getDb();
  await setGeneratorSettingValue(db, "claude_cli_path", claudeCliPath);
  await setGeneratorSettingValue(
    db,
    "generator_verify_command",
    verifyCommand,
  );
  return {
    claudeCliPath,
    verifyCommand,
  };
}

function normalizeQuickLauncherHotkey(input) {
  return String(input ?? "").trim();
}

async function getQuickLauncherHotkey() {
  const db = await getDb();
  const value = await getGeneratorSettingValue(
    db,
    "quick_launcher_hotkey",
    DEFAULT_QUICK_LAUNCHER_HOTKEY,
  );
  const normalized = normalizeQuickLauncherHotkey(value);
  return normalized || DEFAULT_QUICK_LAUNCHER_HOTKEY;
}

async function saveQuickLauncherHotkey(input) {
  const hotkey = normalizeQuickLauncherHotkey(input);
  if (!hotkey) {
    throw new Error("Quick launcher hotkey cannot be empty.");
  }
  const db = await getDb();
  await setGeneratorSettingValue(db, "quick_launcher_hotkey", hotkey);
  return hotkey;
}

async function getRecorderFfmpegPath() {
  const db = await getDb();
  return getGeneratorSettingValue(db, "system_recorder_ffmpeg_path", "");
}

async function saveRecorderFfmpegPath(input) {
  const filePath = String(input ?? "").trim();
  const db = await getDb();
  await setGeneratorSettingValue(db, "system_recorder_ffmpeg_path", filePath);
  return filePath;
}

async function getAiChatSettings() {
  const db = await getDb();
  const provider = await getGeneratorSettingValue(
    db,
    "ai_chat_provider",
    DEFAULT_AI_CHAT_PROVIDER,
  );
  const apiType = await getGeneratorSettingValue(
    db,
    "ai_chat_api_type",
    DEFAULT_AI_CHAT_API_TYPE,
  );
  const debugEnabled = await getGeneratorSettingValue(
    db,
    "ai_chat_debug_enabled",
    DEFAULT_AI_CHAT_DEBUG_ENABLED ? "1" : "0",
  );
  const baseUrl = await getGeneratorSettingValue(db, "ai_chat_base_url", "");
  const apiKey = await getGeneratorSettingValue(db, "ai_chat_api_key", "");
  const model = await getGeneratorSettingValue(db, "ai_chat_model", "");
  return {
    provider: normalizeAiChatProvider(provider),
    apiType: normalizeAiChatApiType(apiType),
    debugEnabled: String(debugEnabled) === "1",
    baseUrl: String(baseUrl ?? "").trim(),
    apiKey: String(apiKey ?? "").trim(),
    model: String(model ?? "").trim(),
  };
}

async function saveAiChatSettings(input) {
  const provider = normalizeAiChatProvider(input?.provider);
  const apiType = normalizeAiChatApiType(input?.apiType);
  const debugEnabled = input?.debugEnabled === true;
  const baseUrl = String(input?.baseUrl ?? "").trim();
  const apiKey = String(input?.apiKey ?? "").trim();
  const model = String(input?.model ?? "").trim();
  const db = await getDb();
  await setGeneratorSettingValue(db, "ai_chat_provider", provider);
  await setGeneratorSettingValue(db, "ai_chat_api_type", apiType);
  await setGeneratorSettingValue(
    db,
    "ai_chat_debug_enabled",
    debugEnabled ? "1" : "0",
  );
  await setGeneratorSettingValue(db, "ai_chat_base_url", baseUrl);
  await setGeneratorSettingValue(db, "ai_chat_api_key", apiKey);
  await setGeneratorSettingValue(db, "ai_chat_model", model);
  return {
    provider,
    apiType,
    debugEnabled,
    baseUrl,
    apiKey,
    model,
  };
}

async function listAiChatSessions() {
  const db = await getDb();
  const rows = await db.all(`
    SELECT id, title, created_at, updated_at
    FROM ai_chat_sessions
    ORDER BY updated_at DESC, created_at DESC, id DESC
  `);
  return rows.map(mapAiChatSessionRow);
}

async function getAiChatSessionById(sessionIdInput) {
  const sessionId = String(sessionIdInput ?? "").trim();
  if (!sessionId) {
    return null;
  }
  const db = await getDb();
  const row = await db.get(
    `SELECT id, title, created_at, updated_at
     FROM ai_chat_sessions
     WHERE id = ?`,
    sessionId,
  );
  return row ? mapAiChatSessionRow(row) : null;
}

async function createAiChatSession(input = {}) {
  const id = createId();
  const now = Date.now();
  const title = normalizeAiChatTitle(input?.title);
  const db = await getDb();
  await db.run(
    `INSERT INTO ai_chat_sessions(id, title, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
    id,
    title,
    now,
    now,
  );
  return {
    id,
    title,
    createdAt: now,
    updatedAt: now,
  };
}

async function updateAiChatSessionTitle(sessionIdInput, titleInput) {
  const sessionId = String(sessionIdInput ?? "").trim();
  if (!sessionId) {
    throw new Error("Session id is required.");
  }
  const title = normalizeAiChatTitle(titleInput);
  const now = Date.now();
  const db = await getDb();
  await db.run(
    `UPDATE ai_chat_sessions
     SET title = ?, updated_at = ?
     WHERE id = ?`,
    title,
    now,
    sessionId,
  );
  return getAiChatSessionById(sessionId);
}

async function touchAiChatSession(sessionIdInput, updatedAtInput = Date.now()) {
  const sessionId = String(sessionIdInput ?? "").trim();
  if (!sessionId) {
    throw new Error("Session id is required.");
  }
  const updatedAt = Number(updatedAtInput);
  const db = await getDb();
  await db.run(
    `UPDATE ai_chat_sessions
     SET updated_at = ?
     WHERE id = ?`,
    updatedAt,
    sessionId,
  );
  return getAiChatSessionById(sessionId);
}

async function deleteAiChatSession(sessionIdInput) {
  const sessionId = String(sessionIdInput ?? "").trim();
  if (!sessionId) {
    throw new Error("Session id is required.");
  }
  const db = await getDb();
  await db.exec("BEGIN");
  try {
    await db.run("DELETE FROM ai_chat_messages WHERE session_id = ?", sessionId);
    await db.run("DELETE FROM ai_chat_sessions WHERE id = ?", sessionId);
    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
  return true;
}

async function listAiChatSessionMessages(sessionIdInput) {
  const sessionId = String(sessionIdInput ?? "").trim();
  if (!sessionId) {
    return [];
  }
  const db = await getDb();
  const rows = await db.all(
    `SELECT id, session_id, role, content, attachments_json, response_id, status, error_message, created_at, updated_at
     FROM ai_chat_messages
     WHERE session_id = ?
     ORDER BY created_at ASC, rowid ASC`,
    sessionId,
  );
  return rows.map(mapAiChatMessageRow);
}

async function createAiChatMessage(input) {
  const sessionId = String(input?.sessionId ?? "").trim();
  if (!sessionId) {
    throw new Error("Session id is required.");
  }
  const role = normalizeAiChatMessageRole(input?.role);
  const content = String(input?.content ?? "");
  const status = normalizeAiChatMessageStatus(input?.status);
  const errorMessage =
    input?.errorMessage === null || input?.errorMessage === undefined
      ? null
      : String(input.errorMessage);
  const responseId =
    input?.responseId === null || input?.responseId === undefined
      ? null
      : String(input.responseId).trim() || null;
  const attachmentsJson = JSON.stringify(
    Array.isArray(input?.attachments)
      ? input.attachments
          .map((item) => ({
            id: String(item?.id ?? "").trim(),
            dataUrl: String(item?.dataUrl ?? "").trim(),
            mimeType: String(item?.mimeType ?? "").trim(),
          }))
          .filter((item) => item.id && item.dataUrl && item.mimeType)
      : [],
  );
  const id = createId();
  const now = Number(input?.createdAt ?? Date.now());
  const db = await getDb();
  await db.run(
    `INSERT INTO ai_chat_messages(
      id, session_id, role, content, attachments_json, response_id, status, error_message, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    sessionId,
    role,
    content,
    attachmentsJson,
    responseId,
    status,
    errorMessage,
    now,
    now,
  );
  await touchAiChatSession(sessionId, now);
  return {
    id,
    sessionId,
    role,
    content,
    attachments: JSON.parse(attachmentsJson),
    responseId,
    status,
    errorMessage,
    createdAt: now,
    updatedAt: now,
  };
}

async function updateAiChatMessage(input) {
  const messageId = String(input?.messageId ?? "").trim();
  if (!messageId) {
    throw new Error("Message id is required.");
  }
  const existing = await getAiChatMessageById(messageId);
  if (!existing) {
    throw new Error(`AI chat message not found: ${messageId}`);
  }
  const content =
    Object.prototype.hasOwnProperty.call(input ?? {}, "content")
      ? String(input.content ?? "")
      : existing.content;
  const status =
    Object.prototype.hasOwnProperty.call(input ?? {}, "status")
      ? normalizeAiChatMessageStatus(input.status)
      : existing.status;
  const errorMessage =
    Object.prototype.hasOwnProperty.call(input ?? {}, "errorMessage")
      ? input.errorMessage === null || input.errorMessage === undefined
        ? null
        : String(input.errorMessage)
      : existing.errorMessage;
  const responseId =
    Object.prototype.hasOwnProperty.call(input ?? {}, "responseId")
      ? input.responseId === null || input.responseId === undefined
        ? null
        : String(input.responseId).trim() || null
      : existing.responseId;
  const attachmentsJson =
    Object.prototype.hasOwnProperty.call(input ?? {}, "attachments")
      ? JSON.stringify(
          Array.isArray(input.attachments)
            ? input.attachments
                .map((item) => ({
                  id: String(item?.id ?? "").trim(),
                  dataUrl: String(item?.dataUrl ?? "").trim(),
                  mimeType: String(item?.mimeType ?? "").trim(),
                }))
                .filter((item) => item.id && item.dataUrl && item.mimeType)
            : [],
        )
      : JSON.stringify(existing.attachments ?? []);
  const updatedAt = Date.now();
  const db = await getDb();
  await db.run(
    `UPDATE ai_chat_messages
     SET content = ?, attachments_json = ?, response_id = ?, status = ?, error_message = ?, updated_at = ?
     WHERE id = ?`,
    content,
    attachmentsJson,
    responseId,
    status,
    errorMessage,
    updatedAt,
    messageId,
  );
  await touchAiChatSession(existing.sessionId, updatedAt);
  return getAiChatMessageById(messageId);
}

async function getAiChatMessageById(messageIdInput) {
  const messageId = String(messageIdInput ?? "").trim();
  if (!messageId) {
    return null;
  }
  const db = await getDb();
  const row = await db.get(
    `SELECT id, session_id, role, content, attachments_json, response_id, status, error_message, created_at, updated_at
     FROM ai_chat_messages
     WHERE id = ?`,
    messageId,
  );
  return row ? mapAiChatMessageRow(row) : null;
}

async function getLatestAiChatResponseId(sessionIdInput) {
  const sessionId = String(sessionIdInput ?? "").trim();
  if (!sessionId) {
    return null;
  }
  const db = await getDb();
  const row = await db.get(
    `SELECT response_id
     FROM ai_chat_messages
     WHERE session_id = ?
       AND role = 'assistant'
       AND status = 'complete'
       AND response_id IS NOT NULL
       AND TRIM(response_id) <> ''
     ORDER BY created_at DESC, rowid DESC
     LIMIT 1`,
    sessionId,
  );
  if (!row) {
    return null;
  }
  return String(row.response_id ?? "").trim() || null;
}

async function reconcileAiChatStreamingMessages() {
  const db = await getDb();
  const updatedAt = Date.now();
  await db.run(
    `UPDATE ai_chat_messages
     SET status = 'error',
         error_message = COALESCE(NULLIF(error_message, ''), 'Interrupted before completion.'),
         updated_at = ?
     WHERE status = 'streaming'`,
    updatedAt,
  );
  await db.run(
    `UPDATE ai_chat_sessions
     SET updated_at = ?
     WHERE id IN (
       SELECT DISTINCT session_id
       FROM ai_chat_messages
       WHERE status = 'error' AND updated_at = ?
     )`,
    updatedAt,
    updatedAt,
  );
  return true;
}

module.exports = {
  createAiChatMessage,
  createAiChatSession,
  closeSettingsStore,
  deleteAiChatSession,
  getAiChatMessageById,
  getLatestAiChatResponseId,
  getAiChatSessionById,
  getAiChatSettings,
  getGeneratorSettings,
  getQuickLauncherHotkey,
  getRecorderFfmpegPath,
  getSettingsTabs,
  initializeSettingsStore,
  listAiChatSessionMessages,
  listAiChatSessions,
  reconcileAiChatStreamingMessages,
  saveRecorderFfmpegPath,
  saveAiChatSettings,
  saveQuickLauncherHotkey,
  saveSettingsTabs,
  saveGeneratorSettings,
  resolveDatabasePath,
  touchAiChatSession,
  updateAiChatMessage,
  updateAiChatSessionTitle,
};
