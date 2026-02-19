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
const RUNNING_OUTPUT_MAX_CHARS = 120000;
const MAX_FILE_READ_BYTES = 200000;
const TERMINAL_OUTPUT_MAX_CHARS = 200000;

const projectRuntime = new Map();
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

function defaultProjectMetadata() {
  const t = now();
  return {
    createdAt: t,
    updatedAt: t,
    runningOutput: "",
    messages: [],
  };
}

function sanitizeMessages(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: String(item.content ?? ""),
      createdAt: Number(item.createdAt ?? now()),
    }));
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
      runningOutput: String(parsed.runningOutput ?? ""),
      messages: sanitizeMessages(parsed.messages),
    };
  } catch {
    return defaultProjectMetadata();
  }
}

function writeProjectMetadata(projectDir, metadata) {
  const next = {
    createdAt: Number(metadata.createdAt ?? now()),
    updatedAt: Number(metadata.updatedAt ?? now()),
    runningOutput: String(metadata.runningOutput ?? ""),
    messages: sanitizeMessages(metadata.messages),
  };
  writeJson(resolveProjectMetadataPath(projectDir), next);
}

function ensureProjectRuntime(projectId, metadata) {
  const existing = projectRuntime.get(projectId);
  if (existing) {
    return existing;
  }

  const state = {
    running: false,
    runningOutput: String(metadata?.runningOutput ?? ""),
    updatedAt: Number(metadata?.updatedAt ?? now()),
  };
  projectRuntime.set(projectId, state);
  return state;
}

function appendRunningOutput(projectId, stream, text) {
  const chunk = String(text ?? "");
  if (!chunk) {
    return;
  }

  const state = ensureProjectRuntime(projectId, null);
  const prefix = stream === "stderr" ? "[stderr] " : "[stdout] ";
  state.runningOutput = `${state.runningOutput}${prefix}${chunk}`;
  if (state.runningOutput.length > RUNNING_OUTPUT_MAX_CHARS) {
    state.runningOutput = state.runningOutput.slice(
      state.runningOutput.length - RUNNING_OUTPUT_MAX_CHARS,
    );
  }
  state.updatedAt = now();
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

function ensureTerminalState(projectId) {
  const existing = terminalRuntime.get(projectId);
  if (existing) {
    return existing;
  }

  const state = {
    running: false,
    output: "",
    startedAt: null,
    updatedAt: now(),
    lastExitCode: null,
    ptyProcess: null,
    shellCommand: "",
    cols: 120,
    rows: 36,
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
  const runtime = ensureProjectRuntime(projectId, metadata);
  const files = collectProjectFiles(projectDir);
  const manifest = readManifestSummary(projectDir);

  return {
    projectId,
    projectDir,
    createdAt: metadata.createdAt,
    updatedAt: Math.max(metadata.updatedAt, runtime.updatedAt),
    running: Boolean(runtime.running),
    runningOutput: String(runtime.runningOutput ?? ""),
    messageCount: metadata.messages.length,
    fileCount: files.filter((item) => item.type === "file").length,
    ...manifest,
  };
}

function buildProjectDetail(projectId) {
  const summary = buildProjectSummary(projectId);
  const metadata = readProjectMetadata(summary.projectDir);
  const files = collectProjectFiles(summary.projectDir);

  return {
    ...summary,
    messages: metadata.messages.map((item) => ({ ...item })),
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
  ensureProjectRuntime(projectId, metadata);

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

function normalizeMessageText(input) {
  return String(input ?? "").trim();
}

function serializeConversation(messages) {
  return messages
    .map((item, index) => `${index + 1}. ${item.role.toUpperCase()}:\n${item.content}`)
    .join("\n\n");
}

function buildClaudeEditPrompt(projectId, messages, userMessage) {
  const conversation = [...messages, { role: "user", content: userMessage }];

  return [
    "You are Claude Code editing files in the current working directory.",
    `Current generator project id: ${projectId}`,
    "Important:",
    "1) Directly modify/create files in this project to satisfy the latest user request.",
    "2) Keep app.json valid JSON.",
    "3) Keep app.json fields: id, name, version, entry, and uiPath.",
    "4) entry and uiPath must point to existing files after your edits.",
    "5) Keep changes minimal and runnable.",
    "6) Reply in Chinese with a short summary of what you changed.",
    "",
    "Conversation history:",
    serializeConversation(conversation),
    "",
    "Now implement the latest user request by editing files directly.",
  ].join("\n");
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
    return { claudeCliPath: "" };
  }
  return settingsStore.getGeneratorSettings();
}

async function saveGeneratorSettings(settingsStore, input) {
  if (!settingsStore?.saveGeneratorSettings) {
    return { claudeCliPath: String(input?.claudeCliPath ?? "").trim() };
  }
  return settingsStore.saveGeneratorSettings(input);
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

async function resolveClaudeExecutable(settingsStore, cliPathOverride) {
  const overridePath = String(cliPathOverride ?? "").trim();
  const detection = await detectClaudeCli(settingsStore);
  const candidates = uniqueStrings([
    ...expandCommandCandidates(overridePath),
    ...(overridePath ? [] : detection.resolvedPath ? [detection.resolvedPath] : []),
    ...collectClaudeCandidates(),
  ]);

  let lastError = null;
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const probe = await probeClaudeCommand(candidate);
    if (probe.ok) {
      return candidate;
    }
    lastError = probe.error;
  }

  if (overridePath) {
    throw new Error(
      `Cannot execute configured Claude CLI path: ${overridePath}. ${lastError ?? ""}`.trim(),
    );
  }
  throw new Error(
    `Claude CLI not found. Please set the path in settings. ${lastError ?? ""}`.trim(),
  );
}

async function runClaudePrompt(executable, prompt, cwd, hooks = {}) {
  const attempts = [
    ["--dangerously-skip-permissions", "-p", prompt],
    ["-p", prompt],
  ];

  let lastError = "Unknown Claude CLI error.";
  for (let i = 0; i < attempts.length; i += 1) {
    const args = attempts[i];
    const result = await runCommand(executable, args, {
      cwd,
      timeoutMs: CHAT_TIMEOUT_MS,
      onStdout: hooks.onStdout,
      onStderr: hooks.onStderr,
    });
    if (result.code === 0) {
      return result;
    }

    lastError = (result.stderr || result.stdout || `exit code ${result.code}`).trim();
  }

  throw new Error(`Claude CLI failed: ${lastError}`);
}

async function chatInProject(settingsStore, projectIdInput, userMessage, cliPathOverride) {
  const { projectId, projectDir } = resolveProjectDir(projectIdInput);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const text = normalizeMessageText(userMessage);
  if (!text) {
    throw new Error("Message is required.");
  }

  const metadata = readProjectMetadata(projectDir);
  const runtime = ensureProjectRuntime(projectId, metadata);
  if (runtime.running) {
    throw new Error("Claude task is already running for this project.");
  }

  const executable = await resolveClaudeExecutable(settingsStore, cliPathOverride);
  const prompt = buildClaudeEditPrompt(projectId, metadata.messages, text);

  runtime.running = true;
  runtime.runningOutput = "[system] Claude command started...\n";
  runtime.updatedAt = now();

  let result;
  try {
    result = await runClaudePrompt(executable, prompt, projectDir, {
      onStdout: (chunk) => appendRunningOutput(projectId, "stdout", chunk),
      onStderr: (chunk) => appendRunningOutput(projectId, "stderr", chunk),
    });
  } finally {
    runtime.running = false;
    runtime.updatedAt = now();
    if (!runtime.runningOutput.trim()) {
      runtime.runningOutput = "[system] Claude command finished with no stream output.\n";
    }
  }

  const assistantText =
    String(result.stdout ?? "").trim() ||
    String(result.stderr ?? "").trim() ||
    "已完成文件修改。";

  const userCreatedAt = now();
  metadata.messages.push({
    role: "user",
    content: text,
    createdAt: userCreatedAt,
  });
  metadata.messages.push({
    role: "assistant",
    content: assistantText,
    createdAt: now(),
  });
  metadata.runningOutput = runtime.runningOutput;
  metadata.updatedAt = now();
  writeProjectMetadata(projectDir, metadata);

  return {
    cliPath: executable,
    assistantMessage: assistantText,
    rawOutput: {
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
    },
    project: buildProjectDetail(projectId),
  };
}

async function installProjectApp(appsManager, projectIdInput, requestedTabId) {
  const { projectId, projectDir } = resolveProjectDir(projectIdInput);
  if (!appsManager?.installAppFromDirectory) {
    throw new Error("Apps manager is unavailable.");
  }

  const runtime = ensureProjectRuntime(projectId, null);
  if (runtime.running) {
    throw new Error("Project is busy. Please wait for Claude task to finish.");
  }

  const summary = readManifestSummary(projectDir);
  if (!summary.hasManifest) {
    throw new Error(`app.json not found in project directory: ${projectDir}`);
  }
  if (!summary.appId) {
    throw new Error("app.json exists but app id is invalid.");
  }

  const tabId = normalizeTabId(requestedTabId, "workspace");
  const existing = appsManager.getAppById
    ? await appsManager.getAppById(summary.appId)
    : null;
  if (existing && appsManager.removeApp) {
    await appsManager.removeApp(summary.appId);
  }

  const installedApps = await appsManager.installAppFromDirectory(projectDir, tabId);
  const metadata = readProjectMetadata(projectDir);
  metadata.updatedAt = now();
  metadata.runningOutput = runtime.runningOutput;
  writeProjectMetadata(projectDir, metadata);
  runtime.updatedAt = metadata.updatedAt;

  return {
    generatedAppId: summary.appId,
    installedApps,
    project: buildProjectDetail(projectId),
  };
}

module.exports = {
  createProject,
  chatInProject,
  detectClaudeCli,
  getGeneratorSettings,
  getProject,
  getProjectTerminal,
  installProjectApp,
  listProjects,
  readProjectFile,
  resizeProjectTerminal,
  sendProjectTerminalInput,
  saveGeneratorSettings,
  subscribeProjectTerminal,
  startProjectTerminal,
  stopProjectTerminal,
};
