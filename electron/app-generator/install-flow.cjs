const {
  GENERATOR_VALIDATION_ERROR_PREFIX,
  GENERATOR_VERIFY_ERROR_PREFIX,
  LEGACY_VERIFY_COMMAND,
  VERIFY_OUTPUT_MAX_CHARS,
  VERIFY_TIMEOUT_MS,
} = require("./constants.cjs");
const {
  encodeErrorPayload,
  hasPackageManifest,
  isLegacyVerifyCommand,
  normalizeTabId,
  normalizeVerifyCommand,
  now,
  readProjectMetadata,
  resolveAutoVerifyCommand,
  resolveProjectDir,
  writeProjectMetadata,
} = require("./fs-utils.cjs");
const { runCommandLine } = require("./command-runner.cjs");
const { getGeneratorSettings } = require("./claude-cli.cjs");
const { buildProjectDetail } = require("./project-store.cjs");
const { ensureTerminalState } = require("./terminal-runtime.cjs");
const { validateProject } = require("./validation.cjs");

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
  // Legacy default depends on package.json; rewrite for template-only projects.
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
  // Verify failure blocks installation and is surfaced via encoded payload.
  if (!verify.success) {
    const payload = encodeErrorPayload({
      verify,
      message: "Verify command failed. Install blocked.",
    });
    throw new Error(`${GENERATOR_VERIFY_ERROR_PREFIX}${payload}`);
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
  installProjectApp,
  runProjectVerify,
};
