const path = require("node:path");
const { DEFAULT_VERIFY_COMMAND } = require("./constants.cjs");
const {
  normalizeVerifyCommand,
  uniqueStrings,
} = require("./fs-utils.cjs");
const { collectCommandFromPath, runCommand } = require("./command-runner.cjs");

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

  // Prefer explicit user configuration before PATH-based auto-detection.
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

module.exports = {
  detectClaudeCli,
  getGeneratorSettings,
  saveGeneratorSettings,
};
