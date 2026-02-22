const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const {
  CHAT_TIMEOUT_MS,
  MAX_OUTPUT_CHARS,
  VERIFY_OUTPUT_MAX_CHARS,
  VERIFY_TIMEOUT_MS,
} = require("./constants.cjs");

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
      // Cap output in memory to keep long-running commands bounded.
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

module.exports = {
  collectCommandFromPath,
  isWindowsBatchLike,
  runCommand,
  runCommandLine,
};
