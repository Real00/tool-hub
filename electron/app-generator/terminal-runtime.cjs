const fs = require("node:fs");
const { TERMINAL_OUTPUT_MAX_CHARS } = require("./constants.cjs");
const { collectCommandFromPath } = require("./command-runner.cjs");
const { now, resolveProjectDir } = require("./fs-utils.cjs");

let nodePty = null;
try {
  // Optional at require-time so startup errors stay actionable.
  nodePty = require("node-pty");
} catch {
  nodePty = null;
}

const terminalRuntime = new Map();
const terminalSubscribers = new Map();
// Runtime-only terminal state keyed by project id.

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
  // System messages are marked so users can distinguish runtime events from shell output.
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

module.exports = {
  ensureTerminalState,
  getProjectTerminal,
  resizeProjectTerminal,
  sendProjectTerminalInput,
  startProjectTerminal,
  stopProjectTerminal,
  subscribeProjectTerminal,
  toPublicTerminalState,
};
