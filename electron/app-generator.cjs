const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { app } = require("electron");
let nodePty = null;
try {
  // Optional at require-time so startup errors stay actionable.
  nodePty = require("node-pty");
} catch {
  nodePty = null;
}

const TOOL_HUB_ROOT_DIR = ".tool-hub";
const GENERATOR_DIR_NAME = "generator";
const METADATA_FILE_NAME = ".toolhub-generator.json";
const TEMPLATE_DIR_REL = "../templates/node-hello-app";

const CHAT_TIMEOUT_MS = 240000;
const MAX_OUTPUT_CHARS = 2_000_000;
const MAX_FILE_READ_BYTES = 200000;
const TERMINAL_OUTPUT_MAX_CHARS = 200000;
const VERIFY_TIMEOUT_MS = 600000;
const VERIFY_OUTPUT_MAX_CHARS = 50000;
const DEFAULT_VERIFY_COMMAND = "node --check src/index.js";
const LEGACY_VERIFY_COMMAND = "pnpm typecheck";
const GENERATOR_VALIDATION_ERROR_PREFIX = "GENERATOR_VALIDATION_FAILED:";
const GENERATOR_VERIFY_ERROR_PREFIX = "GENERATOR_VERIFY_FAILED:";

const terminalRuntime = new Map();
const terminalSubscribers = new Map();

function uniqueStrings(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function now() {
  return Date.now();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function resolveToolHubRoot() {
  return path.join(app.getPath("home"), TOOL_HUB_ROOT_DIR);
}

function resolveGeneratorRoot() {
  return path.join(resolveToolHubRoot(), GENERATOR_DIR_NAME);
}

function resolveTemplateDir() {
  return path.resolve(__dirname, TEMPLATE_DIR_REL);
}

function resolveProjectMetadataPath(projectDir) {
  return path.join(projectDir, METADATA_FILE_NAME);
}

function normalizeAppId(value, fallback) {
  const source = String(value ?? fallback ?? "").trim().toLowerCase();
  return source
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeProjectId(value, fallback = "project") {
  const source = String(value ?? fallback ?? "").trim().toLowerCase();
  const normalized = source
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function normalizeTabId(value, fallback = "workspace") {
  const source = String(value ?? fallback ?? "").trim().toLowerCase();
  const normalized = source
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "workspace";
}

function normalizeVerifyCommand(value) {
  const normalized = String(value ?? "").trim();
  return normalized || DEFAULT_VERIFY_COMMAND;
}

function hasPackageManifest(projectDir) {
  const manifestNames = [
    "package.json",
    "package.yaml",
    "package.yml",
    "package.json5",
  ];
  for (let i = 0; i < manifestNames.length; i += 1) {
    const manifestPath = path.join(projectDir, manifestNames[i]);
    if (fs.existsSync(manifestPath) && fs.statSync(manifestPath).isFile()) {
      return true;
    }
  }
  return false;
}

function isLegacyVerifyCommand(commandInput) {
  return String(commandInput ?? "").trim().toLowerCase() === LEGACY_VERIFY_COMMAND;
}

function resolveAutoVerifyCommand(projectDir) {
  const manifestPath = path.join(projectDir, "app.json");
  if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
    return null;
  }

  let manifest = null;
  try {
    manifest = readJson(manifestPath);
  } catch {
    return null;
  }

  const entryRel = String(manifest?.entry ?? "").trim();
  if (!entryRel) {
    return null;
  }

  let resolved = null;
  try {
    resolved = resolveProjectFile(projectDir, entryRel);
  } catch {
    return null;
  }

  if (
    !resolved?.absolutePath ||
    !fs.existsSync(resolved.absolutePath) ||
    !fs.statSync(resolved.absolutePath).isFile()
  ) {
    return null;
  }

  return `node --check "${resolved.filePath}"`;
}

function encodeErrorPayload(payload) {
  try {
    const json = JSON.stringify(payload ?? {});
    return Buffer.from(json, "utf8").toString("base64url");
  } catch {
    return "";
  }
}

function defaultProjectMetadata() {
  const t = now();
  return {
    createdAt: t,
    updatedAt: t,
  };
}

function readProjectMetadata(projectDir) {
  const metadataPath = resolveProjectMetadataPath(projectDir);
  if (!fs.existsSync(metadataPath)) {
    return defaultProjectMetadata();
  }

  try {
    const parsed = readJson(metadataPath);
    return {
      createdAt: Number(parsed.createdAt ?? now()),
      updatedAt: Number(parsed.updatedAt ?? now()),
    };
  } catch {
    return defaultProjectMetadata();
  }
}

function writeProjectMetadata(projectDir, metadata) {
  const next = {
    createdAt: Number(metadata.createdAt ?? now()),
    updatedAt: Number(metadata.updatedAt ?? now()),
  };
  writeJson(resolveProjectMetadataPath(projectDir), next);
}

function detectTerminalShell() {
  if (process.platform === "win32") {
    const pwshPath = collectCommandFromPath("pwsh")
      .concat(collectCommandFromPath("pwsh.exe"))[0];
    if (pwshPath) {
      return {
        command: pwshPath,
        args: ["-NoLogo", "-NoExit"],
        shellCommand: `${pwshPath} -NoLogo -NoExit`,
      };
    }

    const powershellPath = collectCommandFromPath("powershell")
      .concat(collectCommandFromPath("powershell.exe"))[0];
    if (powershellPath) {
      return {
        command: powershellPath,
        args: ["-NoLogo", "-NoExit"],
        shellCommand: `${powershellPath} -NoLogo -NoExit`,
      };
    }

    const command = process.env.ComSpec || "cmd.exe";
    return {
      command,
      args: ["/Q", "/K"],
      shellCommand: `${command} /Q /K`,
    };
  }

  const shell = process.env.SHELL || "/bin/bash";
  return {
    command: shell,
    args: ["-i"],
    shellCommand: `${shell} -i`,
  };
}

function requireNodePty() {
  if (nodePty?.spawn) {
    return nodePty;
  }
  throw new Error("node-pty is unavailable. Please run `pnpm install` and restart Electron.");
}

function emitTerminalUpdate(projectId) {
  const listeners = terminalSubscribers.get(projectId);
  if (!listeners || listeners.size === 0) {
    return;
  }

  const state = ensureTerminalState(projectId);
  const payload = toPublicTerminalState(projectId, state);
  listeners.forEach((listener) => {
    try {
      listener(payload);
    } catch {
      // Ignore subscriber errors and keep others alive.
    }
  });
}

function subscribeProjectTerminal(projectIdInput, listener) {
  const { projectId } = resolveProjectDir(projectIdInput);
  if (typeof listener !== "function") {
    throw new Error("Terminal subscriber must be a function.");
  }

  let listeners = terminalSubscribers.get(projectId);
  if (!listeners) {
    listeners = new Set();
    terminalSubscribers.set(projectId, listeners);
  }
  listeners.add(listener);

  listener(toPublicTerminalState(projectId, ensureTerminalState(projectId)));
  return () => {
    const current = terminalSubscribers.get(projectId);
    if (!current) {
      return;
    }
    current.delete(listener);
    if (current.size === 0) {
      terminalSubscribers.delete(projectId);
    }
  };
}

function ensureTerminalState(projectId, seed = null) {
  const existing = terminalRuntime.get(projectId);
  if (existing) {
    return existing;
  }

  const state = {
    running: false,
    output: "",
    outputSeq: 0,
    lastChunk: "",
    startedAt: null,
    updatedAt: Number(seed?.updatedAt ?? now()),
    lastExitCode: null,
    ptyProcess: null,
    shellCommand: "",
    cols: Number(seed?.cols ?? 120),
    rows: Number(seed?.rows ?? 36),
  };
  terminalRuntime.set(projectId, state);
  return state;
}

function appendTerminalOutput(projectId, stream, text) {
  const chunk = String(text ?? "");
  if (!chunk) {
    return;
  }

  const state = ensureTerminalState(projectId);
  const rendered = stream === "system" ? `\r\n[tool-hub] ${chunk}` : chunk;
  state.output = `${state.output}${rendered}`;
  state.outputSeq = Number(state.outputSeq ?? 0) + 1;
  state.lastChunk = rendered;
  if (state.output.length > TERMINAL_OUTPUT_MAX_CHARS) {
    state.output = state.output.slice(state.output.length - TERMINAL_OUTPUT_MAX_CHARS);
  }
  state.updatedAt = now();
  emitTerminalUpdate(projectId);
}

function toPublicTerminalState(projectId, state) {
  return {
    projectId,
    running: Boolean(state.running),
    output: String(state.output ?? ""),
    outputSeq: Number(state.outputSeq ?? 0),
    lastChunk: String(state.lastChunk ?? ""),
    startedAt: state.startedAt ? Number(state.startedAt) : null,
    updatedAt: Number(state.updatedAt ?? now()),
    lastExitCode: Number.isInteger(state.lastExitCode) ? state.lastExitCode : null,
    shellCommand: String(state.shellCommand ?? ""),
    cols: Number(state.cols ?? 120),
    rows: Number(state.rows ?? 36),
  };
}

function readManifestSummary(projectDir) {
  const manifestPath = path.join(projectDir, "app.json");
  if (!fs.existsSync(manifestPath)) {
    return {
      hasManifest: false,
      appId: null,
      appName: null,
      version: null,
    };
  }

  try {
    const manifest = readJson(manifestPath);
    return {
      hasManifest: true,
      appId: normalizeAppId(manifest.id, "") || null,
      appName: String(manifest.name ?? "").trim() || null,
      version: String(manifest.version ?? "").trim() || null,
    };
  } catch {
    return {
      hasManifest: true,
      appId: null,
      appName: null,
      version: null,
    };
  }
}

function createStarterManifest(projectDir, projectId) {
  const manifestPath = path.join(projectDir, "app.json");
  if (!fs.existsSync(manifestPath)) {
    return;
  }

  let manifest = {};
  try {
    manifest = readJson(manifestPath);
  } catch {
    manifest = {};
  }

  const suffix = Date.now().toString(36);
  const appId = normalizeAppId(manifest.id, projectId) || `generated-${suffix}`;
  const next = {
    ...manifest,
    id: appId,
    name: String(manifest.name ?? `Generated App ${appId}`).trim() || `Generated App ${appId}`,
    version: String(manifest.version ?? "0.1.0").trim() || "0.1.0",
    entry: String(manifest.entry ?? "src/index.js").trim() || "src/index.js",
    uiPath: String(manifest.uiPath ?? "ui/index.html").trim() || "ui/index.html",
    env: manifest.env && typeof manifest.env === "object" ? manifest.env : {},
  };
  writeJson(manifestPath, next);
}

function normalizeProjectIdInput(projectIdInput) {
  const projectId = String(projectIdInput ?? "").trim();
  if (!projectId) {
    throw new Error("Project id is required.");
  }
  if (projectId.includes("/") || projectId.includes("\\")) {
    throw new Error(`Invalid project id: ${projectId}`);
  }
  return projectId;
}

function resolveProjectDir(projectIdInput) {
  const projectId = normalizeProjectIdInput(projectIdInput);
  const root = resolveGeneratorRoot();
  const projectDir = path.resolve(root, projectId);
  const relative = path.relative(root, projectDir);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Invalid project path: ${projectId}`);
  }
  return { projectId, projectDir };
}

function listProjectIds() {
  const root = resolveGeneratorRoot();
  ensureDir(root);
  const entries = fs.readdirSync(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name);
}

function sortDirentsByName(entries) {
  return [...entries].sort((a, b) => a.name.localeCompare(b.name));
}

function collectProjectFiles(projectDir) {
  const results = [];
  const excludedNames = new Set(["node_modules", ".git", METADATA_FILE_NAME]);

  function walk(relativeDir) {
    const absoluteDir = relativeDir ? path.join(projectDir, relativeDir) : projectDir;
    const dirents = sortDirentsByName(fs.readdirSync(absoluteDir, { withFileTypes: true }));

    for (let i = 0; i < dirents.length; i += 1) {
      const dirent = dirents[i];
      if (excludedNames.has(dirent.name)) {
        continue;
      }

      const relativePath = relativeDir
        ? `${relativeDir.replace(/\\/g, "/")}/${dirent.name}`
        : dirent.name;
      const absolutePath = path.join(projectDir, relativePath);
      const stat = fs.statSync(absolutePath);
      if (dirent.isDirectory()) {
        results.push({
          path: relativePath.replace(/\\/g, "/"),
          type: "directory",
          size: 0,
          modifiedAt: stat.mtimeMs,
        });
        walk(relativePath);
      } else if (dirent.isFile()) {
        results.push({
          path: relativePath.replace(/\\/g, "/"),
          type: "file",
          size: stat.size,
          modifiedAt: stat.mtimeMs,
        });
      }
    }
  }

  walk("");
  return results;
}

function buildProjectSummary(projectId) {
  const { projectDir } = resolveProjectDir(projectId);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    throw new Error(`Project directory not found: ${projectDir}`);
  }

  const metadata = readProjectMetadata(projectDir);
  const terminal = ensureTerminalState(projectId, {
    updatedAt: metadata.updatedAt,
  });
  const files = collectProjectFiles(projectDir);
  const manifest = readManifestSummary(projectDir);

  return {
    projectId,
    projectDir,
    createdAt: metadata.createdAt,
    updatedAt: Math.max(metadata.updatedAt, terminal.updatedAt),
    running: Boolean(terminal.running),
    fileCount: files.filter((item) => item.type === "file").length,
    ...manifest,
  };
}

function buildProjectDetail(projectId) {
  const summary = buildProjectSummary(projectId);
  const files = collectProjectFiles(summary.projectDir);

  return {
    ...summary,
    files,
  };
}

function listProjects() {
  return listProjectIds()
    .map((projectId) => buildProjectSummary(projectId))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function ensureUniqueProjectId(baseId) {
  const root = resolveGeneratorRoot();
  let candidate = baseId;
  let index = 2;

  while (fs.existsSync(path.join(root, candidate))) {
    candidate = `${baseId}-${index}`;
    index += 1;
  }

  return candidate;
}

function createProject(projectName) {
  const templateDir = resolveTemplateDir();
  if (!fs.existsSync(templateDir) || !fs.statSync(templateDir).isDirectory()) {
    throw new Error(`Template directory not found: ${templateDir}`);
  }

  const root = resolveGeneratorRoot();
  ensureDir(root);
  const rawName = String(projectName ?? "").trim();
  const baseId = normalizeProjectId(rawName, `project-${Date.now().toString(36)}`);
  const projectId = ensureUniqueProjectId(baseId);
  const projectDir = path.join(root, projectId);

  fs.cpSync(templateDir, projectDir, {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
  createStarterManifest(projectDir, projectId);

  const metadata = defaultProjectMetadata();
  writeProjectMetadata(projectDir, metadata);
  ensureTerminalState(projectId);

  return buildProjectDetail(projectId);
}

function getProject(projectId) {
  return buildProjectDetail(projectId);
}

function normalizeProjectFilePath(input) {
  const normalized = String(input ?? "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) {
    throw new Error("File path is required.");
  }
  if (normalized.includes("\0")) {
    throw new Error("Invalid file path.");
  }
  return normalized;
}

function resolveProjectFile(projectDir, filePathInput) {
  const filePath = normalizeProjectFilePath(filePathInput);
  const absolutePath = path.resolve(projectDir, filePath);
  const relative = path.relative(projectDir, absolutePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("File path is outside project directory.");
  }
  return {
    absolutePath,
    filePath: relative.replace(/\\/g, "/"),
  };
}

function readProjectFile(projectIdInput, filePathInput) {
  const { projectId, projectDir } = resolveProjectDir(projectIdInput);
  const { absolutePath, filePath } = resolveProjectFile(projectDir, filePathInput);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error(`File not found: ${filePath}`);
  }

  const buffer = fs.readFileSync(absolutePath);
  const truncated = buffer.byteLength > MAX_FILE_READ_BYTES;
  const content = truncated
    ? buffer.subarray(0, MAX_FILE_READ_BYTES).toString("utf8")
    : buffer.toString("utf8");

  return {
    projectId,
    filePath,
    content,
    truncated,
  };
}

function createValidationIssue(level, code, message, filePath = undefined) {
  const issue = {
    code: String(code),
    level: level === "warning" ? "warning" : "error",
    message: String(message),
  };
  if (filePath) {
    issue.path = String(filePath);
  }
  return issue;
}

function createValidationCheck(code, status, message, filePath = undefined) {
  const check = {
    code: String(code),
    status:
      status === "warning" || status === "error"
        ? status
        : "pass",
    message: String(message),
  };
  if (filePath) {
    check.path = String(filePath);
  }
  return check;
}

function validateProject(projectIdInput, requestedTabId) {
  const { projectId, projectDir } = resolveProjectDir(projectIdInput);
  const errors = [];
  const warnings = [];
  const checks = [];
  const validatedAt = now();
  const manifestPath = "app.json";
  const manifestAbsPath = path.join(projectDir, manifestPath);
  const requestedTabText = String(requestedTabId ?? "").trim();
  const targetTabId = requestedTabText
    ? normalizeTabId(requestedTabText, "workspace")
    : null;

  function addError(code, message, filePath) {
    const issue = createValidationIssue("error", code, message, filePath);
    errors.push(issue);
    checks.push(createValidationCheck(code, "error", message, filePath));
  }

  function addWarning(code, message, filePath) {
    const issue = createValidationIssue("warning", code, message, filePath);
    warnings.push(issue);
    checks.push(createValidationCheck(code, "warning", message, filePath));
  }

  function addPass(code, message, filePath) {
    checks.push(createValidationCheck(code, "pass", message, filePath));
  }

  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    addError("PROJECT_DIRECTORY_MISSING", "Project directory does not exist.");
    return {
      projectId,
      validatedAt,
      ok: false,
      errors,
      warnings,
      checks,
      manifestPath,
      normalizedAppId: null,
      targetTabId,
    };
  }

  if (!fs.existsSync(manifestAbsPath) || !fs.statSync(manifestAbsPath).isFile()) {
    addError(
      "MANIFEST_NOT_FOUND",
      "app.json is required before install.",
      manifestPath,
    );
    return {
      projectId,
      validatedAt,
      ok: false,
      errors,
      warnings,
      checks,
      manifestPath,
      normalizedAppId: null,
      targetTabId,
    };
  }
  addPass("MANIFEST_EXISTS", "app.json found.", manifestPath);

  let manifest = null;
  try {
    manifest = readJson(manifestAbsPath);
    addPass("MANIFEST_JSON_VALID", "app.json is valid JSON.", manifestPath);
  } catch (error) {
    addError(
      "MANIFEST_JSON_INVALID",
      `app.json cannot be parsed: ${error instanceof Error ? error.message : String(error)}`,
      manifestPath,
    );
    return {
      projectId,
      validatedAt,
      ok: false,
      errors,
      warnings,
      checks,
      manifestPath,
      normalizedAppId: null,
      targetTabId,
    };
  }

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    addError("MANIFEST_OBJECT_REQUIRED", "app.json root must be an object.", manifestPath);
    return {
      projectId,
      validatedAt,
      ok: false,
      errors,
      warnings,
      checks,
      manifestPath,
      normalizedAppId: null,
      targetTabId,
    };
  }

  const normalizedAppId = normalizeAppId(manifest.id, "");
  if (!normalizedAppId) {
    addError("APP_ID_INVALID", "app.json field `id` is required and must be valid.", manifestPath);
  } else {
    addPass("APP_ID_VALID", `App id: ${normalizedAppId}`, manifestPath);
  }

  const appName = String(manifest.name ?? "").trim();
  if (!appName) {
    addError("APP_NAME_REQUIRED", "app.json field `name` is required.", manifestPath);
  } else {
    addPass("APP_NAME_VALID", `App name: ${appName}`, manifestPath);
  }

  const version = String(manifest.version ?? "").trim();
  if (!version) {
    addWarning("APP_VERSION_MISSING", "app.json field `version` is missing.");
  } else {
    addPass("APP_VERSION_PRESENT", `App version: ${version}`, manifestPath);
  }

  const entryRel = String(manifest.entry ?? "").trim();
  if (!entryRel) {
    addError("APP_ENTRY_MISSING", "app.json field `entry` is required.", manifestPath);
  } else {
    try {
      const { absolutePath, filePath } = resolveProjectFile(projectDir, entryRel);
      if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
        addError("APP_ENTRY_NOT_FOUND", `Entry file not found: ${filePath}`, filePath);
      } else {
        addPass("APP_ENTRY_OK", `Entry file found: ${filePath}`, filePath);
      }
    } catch (error) {
      addError(
        "APP_ENTRY_INVALID",
        `Invalid entry path: ${error instanceof Error ? error.message : String(error)}`,
        manifestPath,
      );
    }
  }

  const uiPathRaw = manifest.uiPath;
  const uiPath = typeof uiPathRaw === "string" ? uiPathRaw.trim() : "";
  if (typeof uiPathRaw !== "undefined" && typeof uiPathRaw !== "string") {
    addError("UI_PATH_INVALID_TYPE", "`uiPath` must be a string when provided.", manifestPath);
  } else if (uiPath) {
    try {
      const { absolutePath, filePath } = resolveProjectFile(projectDir, uiPath);
      if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
        addError("UI_PATH_NOT_FOUND", `uiPath file not found: ${filePath}`, filePath);
      } else {
        addPass("UI_PATH_OK", `uiPath file found: ${filePath}`, filePath);
      }
    } catch (error) {
      addError(
        "UI_PATH_INVALID",
        `Invalid uiPath: ${error instanceof Error ? error.message : String(error)}`,
        manifestPath,
      );
    }
  } else {
    addPass("UI_PATH_OPTIONAL", "uiPath is optional.");
  }

  const uiUrlRaw = manifest.uiUrl;
  const uiUrl = typeof uiUrlRaw === "string" ? uiUrlRaw.trim() : "";
  if (typeof uiUrlRaw !== "undefined" && typeof uiUrlRaw !== "string") {
    addError("UI_URL_INVALID_TYPE", "`uiUrl` must be a string when provided.", manifestPath);
  } else if (uiUrl) {
    if (!/^https?:\/\//i.test(uiUrl)) {
      addError("UI_URL_INVALID", "uiUrl must start with http:// or https://.", manifestPath);
    } else {
      addPass("UI_URL_OK", `uiUrl is valid: ${uiUrl}`, manifestPath);
    }
  } else {
    addPass("UI_URL_OPTIONAL", "uiUrl is optional.");
  }

  if (uiPath && uiUrl) {
    addWarning(
      "UI_PATH_AND_URL_BOTH_SET",
      "Both uiPath and uiUrl are set; uiUrl takes precedence when app opens.",
      manifestPath,
    );
  }

  if (Object.prototype.hasOwnProperty.call(manifest, "env")) {
    if (
      manifest.env &&
      typeof manifest.env === "object" &&
      !Array.isArray(manifest.env)
    ) {
      addPass("ENV_OBJECT_OK", "`env` is an object.", manifestPath);
    } else {
      addWarning("ENV_NOT_OBJECT", "`env` should be an object.", manifestPath);
    }
  } else {
    addPass("ENV_OPTIONAL", "`env` is optional.");
  }

  if (!requestedTabText) {
    addWarning(
      "TARGET_TAB_EMPTY",
      "Target tab is empty; install flow will fallback to workspace.",
    );
  } else {
    addPass(
      "TARGET_TAB_SET",
      `Target tab: ${targetTabId}`,
    );
  }

  return {
    projectId,
    validatedAt,
    ok: errors.length === 0,
    errors,
    warnings,
    checks,
    manifestPath,
    normalizedAppId: normalizedAppId || null,
    targetTabId,
  };
}

function runCommandLine(commandLineInput, options = {}) {
  return new Promise((resolve, reject) => {
    const commandLine = String(commandLineInput ?? "").trim();
    if (!commandLine) {
      reject(new Error("Command line is empty."));
      return;
    }

    const timeoutMs =
      Number.isFinite(Number(options.timeoutMs)) && Number(options.timeoutMs) > 0
        ? Math.max(1000, Math.floor(Number(options.timeoutMs)))
        : VERIFY_TIMEOUT_MS;
    const maxOutputChars =
      Number.isFinite(Number(options.maxOutputChars)) &&
      Number(options.maxOutputChars) > 0
        ? Math.max(512, Math.floor(Number(options.maxOutputChars)))
        : VERIFY_OUTPUT_MAX_CHARS;
    let output = "";
    let truncated = false;
    let settled = false;

    const child = spawn(commandLine, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env || {}) },
      shell: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    function appendOutput(chunk) {
      const text = String(chunk ?? "");
      if (!text) {
        return;
      }
      if (output.length >= maxOutputChars) {
        truncated = true;
        return;
      }
      const remain = maxOutputChars - output.length;
      if (text.length <= remain) {
        output += text;
        return;
      }
      output += text.slice(0, remain);
      truncated = true;
    }

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        child.kill();
      } catch {
        // Ignore kill errors for terminated child process.
      }
      resolve({
        code: null,
        output,
        truncated,
        timedOut: true,
      });
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      appendOutput(chunk);
      if (typeof options.onStdout === "function") {
        options.onStdout(chunk);
      }
    });
    child.stderr?.on("data", (chunk) => {
      appendOutput(chunk);
      if (typeof options.onStderr === "function") {
        options.onStderr(chunk);
      }
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        code: Number.isInteger(code) ? Number(code) : null,
        output,
        truncated,
        timedOut: false,
      });
    });
  });
}

function getProjectTerminal(projectIdInput) {
  const { projectId, projectDir } = resolveProjectDir(projectIdInput);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const state = ensureTerminalState(projectId);
  return toPublicTerminalState(projectId, state);
}

function startProjectTerminal(projectIdInput) {
  const { projectId, projectDir } = resolveProjectDir(projectIdInput);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const state = ensureTerminalState(projectId);
  if (state.running) {
    return toPublicTerminalState(projectId, state);
  }

  const pty = requireNodePty();
  const shell = detectTerminalShell();
  const cols = Number(state.cols ?? 120) || 120;
  const rows = Number(state.rows ?? 36) || 36;
  const ptyProcess = pty.spawn(shell.command, shell.args, {
    name: "xterm-256color",
    cols,
    rows,
    cwd: projectDir,
    env: { ...process.env, TERM: "xterm-256color" },
  });

  state.ptyProcess = ptyProcess;
  state.running = true;
  state.startedAt = now();
  state.updatedAt = now();
  state.lastExitCode = null;
  state.shellCommand = shell.shellCommand;
  state.cols = cols;
  state.rows = rows;
  appendTerminalOutput(projectId, "system", `terminal started (${shell.shellCommand})\n`);
  emitTerminalUpdate(projectId);

  ptyProcess.onData((chunk) => {
    appendTerminalOutput(projectId, "stdout", chunk);
  });

  ptyProcess.onExit((event) => {
    state.running = false;
    state.ptyProcess = null;
    state.lastExitCode = Number.isInteger(event?.exitCode) ? Number(event.exitCode) : null;
    state.updatedAt = now();
    appendTerminalOutput(
      projectId,
      "system",
      `terminal exited (code=${state.lastExitCode ?? "null"})\n`,
    );
    emitTerminalUpdate(projectId);
  });

  return toPublicTerminalState(projectId, state);
}

function sendProjectTerminalInput(projectIdInput, textInput, appendNewlineInput = true) {
  const { projectId } = resolveProjectDir(projectIdInput);
  const state = ensureTerminalState(projectId);
  if (!state.running || !state.ptyProcess) {
    throw new Error("Terminal is not running.");
  }

  const text = String(textInput ?? "");
  const appendNewline = appendNewlineInput !== false;
  const payload = appendNewline ? `${text}\r` : text;
  if (!payload) {
    return toPublicTerminalState(projectId, state);
  }

  state.ptyProcess.write(payload);
  state.updatedAt = now();
  emitTerminalUpdate(projectId);
  return toPublicTerminalState(projectId, state);
}

function stopProjectTerminal(projectIdInput) {
  const { projectId } = resolveProjectDir(projectIdInput);
  const state = ensureTerminalState(projectId);
  if (state.running && state.ptyProcess) {
    state.ptyProcess.kill();
  }
  return toPublicTerminalState(projectId, state);
}

function resizeProjectTerminal(projectIdInput, colsInput, rowsInput) {
  const { projectId } = resolveProjectDir(projectIdInput);
  const state = ensureTerminalState(projectId);
  const cols = Math.max(20, Math.min(400, Number(colsInput || 120)));
  const rows = Math.max(8, Math.min(200, Number(rowsInput || 36)));
  state.cols = cols;
  state.rows = rows;
  if (state.running && state.ptyProcess) {
    try {
      state.ptyProcess.resize(cols, rows);
    } catch {
      // Ignore invalid resize calls from transient layout.
    }
  }
  state.updatedAt = now();
  emitTerminalUpdate(projectId);
  return toPublicTerminalState(projectId, state);
}

function isWindowsBatchLike(command) {
  const ext = path.extname(String(command ?? "")).toLowerCase();
  return ext === ".cmd" || ext === ".bat";
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      shell: process.platform === "win32" && isWindowsBatchLike(command),
      env: process.env,
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeoutMs = options.timeoutMs ?? CHAT_TIMEOUT_MS;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill();
      const stdOutTail = stdout.trim().slice(-2000);
      const stdErrTail = stderr.trim().slice(-2000);
      const detail = [
        `Command timed out after ${timeoutMs} ms.`,
        stdOutTail ? `stdout(tail): ${stdOutTail}` : "",
        stdErrTail ? `stderr(tail): ${stdErrTail}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      reject(new Error(detail));
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      if (typeof options.onStdout === "function") {
        options.onStdout(chunk);
      }
      if (stdout.length < MAX_OUTPUT_CHARS) {
        stdout += String(chunk);
      }
    });
    child.stderr?.on("data", (chunk) => {
      if (typeof options.onStderr === "function") {
        options.onStderr(chunk);
      }
      if (stderr.length < MAX_OUTPUT_CHARS) {
        stderr += String(chunk);
      }
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ code: Number(code ?? 0), stdout, stderr });
    });
  });
}

function collectCommandFromPath(binaryName) {
  const command = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(command, [binaryName], {
    windowsHide: true,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return [];
  }

  return String(result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function collectClaudeCandidates() {
  const candidates = [
    ...collectCommandFromPath("claude"),
    ...collectCommandFromPath("claude.cmd"),
    ...collectCommandFromPath("claude-code"),
    ...collectCommandFromPath("claude-code.cmd"),
    "claude",
    "claude.cmd",
    "claude-code",
    "claude-code.cmd",
  ];
  return uniqueStrings(candidates);
}

function expandCommandCandidates(command) {
  const source = String(command ?? "").trim();
  if (!source) {
    return [];
  }

  const results = [source];
  if (process.platform === "win32" && !path.extname(source)) {
    results.push(`${source}.cmd`);
    results.push(`${source}.exe`);
  }
  return uniqueStrings(results);
}

async function probeClaudeCommand(command) {
  try {
    const result = await runCommand(command, ["--version"], { timeoutMs: 10000 });
    if (result.code === 0) {
      const versionText = (result.stdout || result.stderr || "").trim().split(/\r?\n/)[0] || null;
      return { ok: true, version: versionText };
    }
    return { ok: false, error: result.stderr || result.stdout || `exit code ${result.code}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function getGeneratorSettings(settingsStore) {
  if (!settingsStore?.getGeneratorSettings) {
    return {
      claudeCliPath: "",
      verifyCommand: DEFAULT_VERIFY_COMMAND,
    };
  }
  const saved = await settingsStore.getGeneratorSettings();
  return {
    claudeCliPath: String(saved?.claudeCliPath ?? "").trim(),
    verifyCommand: normalizeVerifyCommand(saved?.verifyCommand),
  };
}

async function saveGeneratorSettings(settingsStore, input) {
  const normalizedInput = {
    claudeCliPath: String(input?.claudeCliPath ?? "").trim(),
    verifyCommand: normalizeVerifyCommand(input?.verifyCommand),
  };
  if (!settingsStore?.saveGeneratorSettings) {
    return normalizedInput;
  }
  return settingsStore.saveGeneratorSettings(normalizedInput);
}

async function detectClaudeCli(settingsStore) {
  const saved = await getGeneratorSettings(settingsStore);
  const configuredPath = String(saved.claudeCliPath ?? "").trim();

  const orderedCandidates = uniqueStrings([
    ...expandCommandCandidates(configuredPath),
    ...collectClaudeCandidates(),
  ]);

  let resolvedPath = null;
  let version = null;
  let source = "none";

  for (let i = 0; i < orderedCandidates.length; i += 1) {
    const candidate = orderedCandidates[i];
    const probe = await probeClaudeCommand(candidate);
    if (!probe.ok) {
      continue;
    }
    resolvedPath = candidate;
    version = probe.version;
    source = configuredPath && expandCommandCandidates(configuredPath).includes(candidate)
      ? "configured"
      : "detected";
    break;
  }

  return {
    configuredPath,
    resolvedPath,
    version,
    source,
    candidates: orderedCandidates,
  };
}

async function runProjectVerify(
  projectIdInput,
  settingsStore,
  commandOverrideInput,
) {
  const { projectId, projectDir } = resolveProjectDir(projectIdInput);
  const terminal = ensureTerminalState(projectId);
  if (terminal.running) {
    throw new Error("Project terminal is running. Please stop it before verify.");
  }

  const saved = await getGeneratorSettings(settingsStore);
  const configuredCommand = String(commandOverrideInput || saved.verifyCommand || "").trim();
  let command = normalizeVerifyCommand(configuredCommand);
  let commandRewriteNote = "";
  if (isLegacyVerifyCommand(command) && !hasPackageManifest(projectDir)) {
    const autoCommand = resolveAutoVerifyCommand(projectDir);
    if (autoCommand) {
      commandRewriteNote =
        `[tool-hub] verify command "${LEGACY_VERIFY_COMMAND}" requires package.json.\n` +
        `[tool-hub] switched to "${autoCommand}" for this project.\n`;
      command = autoCommand;
    }
  }
  const startedAt = now();
  let execution = null;

  try {
    execution = await runCommandLine(command, {
      cwd: projectDir,
      timeoutMs: VERIFY_TIMEOUT_MS,
      maxOutputChars: VERIFY_OUTPUT_MAX_CHARS,
    });
  } catch (error) {
    execution = {
      code: null,
      output: `Failed to execute verify command: ${error instanceof Error ? error.message : String(error)}`,
      truncated: false,
      timedOut: false,
    };
  }

  const finishedAt = now();
  const timedOut = execution.timedOut === true;
  let output = `${commandRewriteNote}${String(execution.output ?? "")}`;
  if (timedOut) {
    output = `${output}\n[tool-hub] verify command timed out after ${VERIFY_TIMEOUT_MS} ms`;
  }
  if (output.length > VERIFY_OUTPUT_MAX_CHARS) {
    output = output.slice(output.length - VERIFY_OUTPUT_MAX_CHARS);
  }

  const result = {
    projectId,
    command,
    success:
      Number.isInteger(execution.code) &&
      Number(execution.code) === 0 &&
      !timedOut,
    exitCode: Number.isInteger(execution.code) ? Number(execution.code) : null,
    output,
    truncated: Boolean(execution.truncated) || output.length >= VERIFY_OUTPUT_MAX_CHARS,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, finishedAt - startedAt),
  };

  const metadata = readProjectMetadata(projectDir);
  metadata.updatedAt = finishedAt;
  writeProjectMetadata(projectDir, metadata);
  terminal.updatedAt = metadata.updatedAt;

  return result;
}

async function installProjectApp(
  appsManager,
  settingsStore,
  projectIdInput,
  requestedTabId,
  overwriteExisting = false,
  verifyCommandOverride = "",
) {
  const { projectId, projectDir } = resolveProjectDir(projectIdInput);
  if (!appsManager?.installAppFromDirectory) {
    throw new Error("Apps manager is unavailable.");
  }

  const terminal = ensureTerminalState(projectId);
  if (terminal.running) {
    throw new Error("Project terminal is running. Please stop it before install.");
  }

  const validation = validateProject(projectId, requestedTabId);
  if (!validation.ok || !validation.normalizedAppId) {
    const payload = encodeErrorPayload({
      validation,
      message: validation.errors[0]?.message || "Project validation failed.",
    });
    throw new Error(`${GENERATOR_VALIDATION_ERROR_PREFIX}${payload}`);
  }

  const tabId = normalizeTabId(requestedTabId, "workspace");
  const shouldOverwrite = overwriteExisting === true;
  const appId = validation.normalizedAppId;
  const existing = appsManager.getAppById
    ? await appsManager.getAppById(appId)
    : null;
  if (existing && !shouldOverwrite) {
    throw new Error(`APP_ALREADY_INSTALLED:${appId}`);
  }

  const verify = await runProjectVerify(
    projectId,
    settingsStore,
    verifyCommandOverride,
  );
  if (!verify.success) {
    const payload = encodeErrorPayload({
      verify,
      message: "Verify command failed. Install blocked.",
    });
    throw new Error(`${GENERATOR_VERIFY_ERROR_PREFIX}${payload}`);
  }

  if (existing && appsManager.removeApp) {
    await appsManager.removeApp(appId);
  }

  const installedApps = await appsManager.installAppFromDirectory(projectDir, tabId, shouldOverwrite);
  const metadata = readProjectMetadata(projectDir);
  metadata.updatedAt = now();
  writeProjectMetadata(projectDir, metadata);
  terminal.updatedAt = metadata.updatedAt;

  return {
    generatedAppId: appId,
    installedApps,
    project: buildProjectDetail(projectId),
    validation,
    verify,
  };
}

module.exports = {
  createProject,
  detectClaudeCli,
  getGeneratorSettings,
  getProject,
  getProjectTerminal,
  installProjectApp,
  listProjects,
  readProjectFile,
  runProjectVerify,
  resizeProjectTerminal,
  sendProjectTerminalInput,
  saveGeneratorSettings,
  subscribeProjectTerminal,
  startProjectTerminal,
  stopProjectTerminal,
  validateProject,
};
