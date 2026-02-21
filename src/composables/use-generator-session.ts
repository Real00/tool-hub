import { ref, type Ref } from "vue";
import type { InstalledApp } from "../types/app";
import type {
  GeneratorProjectDetail,
  GeneratorProjectSummary,
  GeneratorTerminalState,
  GeneratorValidationResult,
  GeneratorVerifyResult,
} from "../types/generator";
import type { TabDefinition } from "../types/settings";
import {
  createGeneratorProject,
  detectClaudeCli,
  getGeneratorProjectTerminal,
  getGeneratorProject,
  getGeneratorSettings,
  installGeneratorProjectApp,
  isElectronRuntime,
  listGeneratorProjects,
  readGeneratorProjectFile,
  resizeGeneratorProjectTerminal,
  runGeneratorProjectVerify as runGeneratorProjectVerifyBridge,
  saveGeneratorSettings,
  sendGeneratorProjectTerminalInput,
  subscribeGeneratorProjectTerminal,
  startGeneratorProjectTerminal,
  stopGeneratorProjectTerminal,
  updateGeneratorProjectAgents,
  validateGeneratorProject,
} from "../platform/electron-bridge";

interface InstallResultPayload {
  apps: InstalledApp[];
  generatedAppId: string;
  tabId: string;
}

interface UseGeneratorSessionOptions {
  tabs: Ref<TabDefinition[]>;
  onInstalled?: (payload: InstallResultPayload) => void;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

const APP_ALREADY_INSTALLED_PREFIX = "APP_ALREADY_INSTALLED:";
const GENERATOR_VALIDATION_ERROR_PREFIX = "GENERATOR_VALIDATION_FAILED:";
const GENERATOR_VERIFY_ERROR_PREFIX = "GENERATOR_VERIFY_FAILED:";

function parseAlreadyInstalledAppId(error: unknown): string | null {
  const message = formatError(error).trim();
  const pattern = /APP_ALREADY_INSTALLED:([a-z0-9-]+)/i;
  const match = message.match(pattern);
  if (match) {
    return String(match[1] ?? "").trim() || "";
  }
  return null;
}

function decodeBase64Url(input: string): string | null {
  const source = String(input ?? "").trim();
  if (!source) {
    return null;
  }
  try {
    const base64 = source.replace(/-/g, "+").replace(/_/g, "/");
    const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`;
    if (typeof atob === "function") {
      const binary = atob(padded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new TextDecoder().decode(bytes);
    }
  } catch {
    return null;
  }
  return null;
}

function parseGeneratorPayloadError<T>(error: unknown, prefix: string): T | null {
  const message = formatError(error).trim();
  if (!message.startsWith(prefix)) {
    return null;
  }
  const encoded = message.slice(prefix.length).trim();
  const decoded = decodeBase64Url(encoded);
  if (!decoded) {
    return null;
  }
  try {
    return JSON.parse(decoded) as T;
  } catch {
    return null;
  }
}

function createVerifyResultFromError(
  projectId: string,
  command: string,
  message: string,
): GeneratorVerifyResult {
  const finishedAt = Date.now();
  return {
    projectId,
    command,
    success: false,
    exitCode: null,
    output: message,
    truncated: false,
    startedAt: finishedAt,
    finishedAt,
    durationMs: 0,
  };
}

function toSummary(project: GeneratorProjectDetail): GeneratorProjectSummary {
  return {
    projectId: project.projectId,
    projectDir: project.projectDir,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    running: project.running,
    fileCount: project.fileCount,
    hasManifest: project.hasManifest,
    appId: project.appId,
    appName: project.appName,
    version: project.version,
  };
}

function emptyTerminalState(projectId = ""): GeneratorTerminalState {
  const t = Date.now();
  return {
    projectId,
    running: false,
    output: "",
    outputSeq: 0,
    lastChunk: "",
    startedAt: null,
    updatedAt: t,
    lastExitCode: null,
    shellCommand: "",
    cols: 120,
    rows: 36,
  };
}

function buildClaudeBaseCommand(input: string): string {
  const source = String(input ?? "").trim();
  if (!source) {
    return "claude";
  }
  if (/["'`]/.test(source)) {
    return source;
  }
  if (!/\s/.test(source)) {
    return source;
  }

  const withArgsMatch = source.match(
    /^((?:[A-Za-z]:[\\/]|\\\\)[^\r\n"]+?\.(?:exe|cmd|bat|ps1))(\s+.+)$/i,
  );
  if (withArgsMatch) {
    const executablePath = withArgsMatch[1];
    const argsText = withArgsMatch[2];
    return executablePath.includes(" ") ? `"${executablePath}"${argsText}` : source;
  }

  const looksLikePath =
    /^[A-Za-z]:[\\/]/.test(source) ||
    source.startsWith("\\\\") ||
    source.includes("\\") ||
    source.includes("/") ||
    /\.(exe|cmd|bat|ps1)$/i.test(source);
  return looksLikePath ? `"${source}"` : source;
}

function hasConversationStartupFlag(command: string): boolean {
  return /(^|\s)(--continue|--resume|--new|-c|-r|-n)(?=\s|$)/i.test(command);
}

function isPowerShellCommand(shellCommand: string): boolean {
  const source = String(shellCommand ?? "").toLowerCase();
  return source.includes("pwsh") || source.includes("powershell");
}

function buildClaudeLaunchCommand(input: string, shellCommand = ""): string {
  const baseCommand = buildClaudeBaseCommand(input);
  if (hasConversationStartupFlag(baseCommand)) {
    return baseCommand;
  }

  const resumeCommand = `${baseCommand} --continue`;
  if (isPowerShellCommand(shellCommand)) {
    return `${resumeCommand}; if ($LASTEXITCODE -ne 0) { ${baseCommand} }`;
  }
  return `${resumeCommand} || ${baseCommand}`;
}

export function useGeneratorSession(options: UseGeneratorSessionOptions) {
  const generatorStatus = ref<"idle" | "loading" | "success" | "error">("idle");
  const generatorMessage = ref("Use Claude CLI to edit files in generator projects.");
  const claudeCliPath = ref("");
  const verifyCommand = ref("node --check src/index.js");
  const generatorProjectName = ref("");
  const generatorTabId = ref(options.tabs.value[0]?.id ?? "workspace");

  const generatorProjects = ref<GeneratorProjectSummary[]>([]);
  const generatorProjectId = ref("");
  const generatorProject = ref<GeneratorProjectDetail | null>(null);

  const generatorFilePath = ref("");
  const generatorFileContent = ref("");
  const generatorFileTruncated = ref(false);
  const generatorFileLoading = ref(false);
  const generatorValidationResult = ref<GeneratorValidationResult | null>(null);
  const generatorValidationStatus = ref<"idle" | "loading" | "success" | "error">("idle");
  const generatorValidationMessage = ref(
    "Validation checks app.json and project files before install.",
  );
  const generatorVerifyResult = ref<GeneratorVerifyResult | null>(null);
  const generatorVerifyStatus = ref<"idle" | "loading" | "success" | "error">("idle");
  const generatorVerifyMessage = ref(
    "Verify command will run automatically before install.",
  );
  const generatorTerminal = ref<GeneratorTerminalState>(emptyTerminalState(""));
  const generatorTerminalStatus = ref<"idle" | "loading" | "success" | "error">("idle");
  const generatorTerminalMessage = ref("Embedded terminal is ready.");

  let generatorTerminalUnsubscribe: (() => void) | null = null;

  function syncGeneratorTabIdWithTabs() {
    if (!options.tabs.value.some((tab) => tab.id === generatorTabId.value)) {
      generatorTabId.value = options.tabs.value[0]?.id ?? "workspace";
    }
  }

  function clearSelectedProjectData() {
    detachGeneratorTerminalSubscription();
    generatorProjectId.value = "";
    generatorProject.value = null;
    generatorFilePath.value = "";
    generatorFileContent.value = "";
    generatorFileTruncated.value = false;
    generatorValidationResult.value = null;
    generatorValidationStatus.value = "idle";
    generatorValidationMessage.value =
      "Validation checks app.json and project files before install.";
    generatorVerifyResult.value = null;
    generatorVerifyStatus.value = "idle";
    generatorVerifyMessage.value =
      "Verify command will run automatically before install.";
    generatorTerminal.value = emptyTerminalState("");
    generatorTerminalStatus.value = "idle";
    generatorTerminalMessage.value = "Embedded terminal is ready.";
  }

  function detachGeneratorTerminalSubscription() {
    if (generatorTerminalUnsubscribe) {
      generatorTerminalUnsubscribe();
      generatorTerminalUnsubscribe = null;
    }
  }

  function attachGeneratorTerminalSubscription(projectIdInput?: string) {
    if (!isElectronRuntime()) {
      return;
    }
    const projectId = String(projectIdInput ?? generatorProjectId.value).trim();
    if (!projectId) {
      return;
    }

    detachGeneratorTerminalSubscription();
    generatorTerminalUnsubscribe = subscribeGeneratorProjectTerminal(projectId, (state) => {
      generatorTerminal.value = state;
    });
  }

  function upsertProjectSummary(summary: GeneratorProjectSummary) {
    const list = [...generatorProjects.value];
    const index = list.findIndex((item) => item.projectId === summary.projectId);
    if (index >= 0) {
      list[index] = summary;
    } else {
      list.push(summary);
    }
    list.sort((a, b) => b.updatedAt - a.updatedAt);
    generatorProjects.value = list;
  }

  function syncSelectedFilePath(detail: GeneratorProjectDetail): string {
    if (
      generatorFilePath.value &&
      detail.files.some((item) => item.type === "file" && item.path === generatorFilePath.value)
    ) {
      return generatorFilePath.value;
    }

    const nextPath = detail.files.find((item) => item.type === "file")?.path ?? "";
    generatorFilePath.value = nextPath;
    if (!nextPath) {
      generatorFileContent.value = "";
      generatorFileTruncated.value = false;
    }
    return nextPath;
  }

  async function loadGeneratorSettingsFromStorage() {
    if (!isElectronRuntime()) {
      generatorStatus.value = "idle";
      generatorMessage.value = "Generator configuration is available in Electron runtime.";
      return;
    }

    try {
      const settings = await getGeneratorSettings();
      claudeCliPath.value = settings.claudeCliPath;
      verifyCommand.value = settings.verifyCommand;
      generatorStatus.value = "idle";
      generatorMessage.value = settings.claudeCliPath
        ? "Generator settings loaded from local storage."
        : "Claude CLI path is empty. Auto-detect or set it manually.";
    } catch (error) {
      generatorStatus.value = "error";
      generatorMessage.value = `Load generator settings failed: ${formatError(error)}`;
    }
  }

  async function openGeneratorProjectFile(filePath: string) {
    if (!isElectronRuntime()) {
      generatorFilePath.value = "";
      generatorFileContent.value = "";
      generatorFileTruncated.value = false;
      return;
    }
    if (!generatorProjectId.value) {
      return;
    }

    const targetPath = filePath.trim();
    if (!targetPath) {
      generatorFilePath.value = "";
      generatorFileContent.value = "";
      generatorFileTruncated.value = false;
      return;
    }

    generatorFileLoading.value = true;
    try {
      const content = await readGeneratorProjectFile(generatorProjectId.value, targetPath);
      generatorFilePath.value = content.filePath;
      generatorFileContent.value = content.content;
      generatorFileTruncated.value = content.truncated;
    } catch (error) {
      generatorFileContent.value = "";
      generatorFileTruncated.value = false;
      generatorStatus.value = "error";
      generatorMessage.value = `Load file failed: ${formatError(error)}`;
    } finally {
      generatorFileLoading.value = false;
    }
  }

  async function refreshSelectedProject(projectId: string) {
    const detail = await getGeneratorProject(projectId);
    generatorProjectId.value = detail.projectId;
    generatorProject.value = detail;
    upsertProjectSummary(toSummary(detail));
    const selectedFile = syncSelectedFilePath(detail);
    if (selectedFile) {
      await openGeneratorProjectFile(selectedFile);
    }
    await loadGeneratorTerminalState(projectId);
    attachGeneratorTerminalSubscription(projectId);
  }

  async function loadGeneratorTerminalState(projectIdInput?: string) {
    if (!isElectronRuntime()) {
      generatorTerminal.value = emptyTerminalState("");
      return;
    }

    const projectId = String(projectIdInput ?? generatorProjectId.value).trim();
    if (!projectId) {
      generatorTerminal.value = emptyTerminalState("");
      return;
    }

    try {
      generatorTerminal.value = await getGeneratorProjectTerminal(projectId);
      generatorTerminalStatus.value = "idle";
      generatorTerminalMessage.value = generatorTerminal.value.running
        ? "Terminal is running."
        : "Terminal is stopped.";
    } catch (error) {
      generatorTerminalStatus.value = "error";
      generatorTerminalMessage.value = `Load terminal failed: ${formatError(error)}`;
    }
  }

  async function selectGeneratorProject(projectId: string) {
    if (!isElectronRuntime()) {
      clearSelectedProjectData();
      return;
    }

    const targetId = projectId.trim();
    if (!targetId) {
      clearSelectedProjectData();
      return;
    }

    generatorStatus.value = "loading";
    generatorMessage.value = "Loading generator project...";
    try {
      await refreshSelectedProject(targetId);
      generatorStatus.value = "success";
      generatorMessage.value = `Loaded project: ${targetId}`;
    } catch (error) {
      clearSelectedProjectData();
      generatorStatus.value = "error";
      generatorMessage.value = `Load project failed: ${formatError(error)}`;
    }
  }

  async function loadGeneratorProjects() {
    if (!isElectronRuntime()) {
      generatorProjects.value = [];
      clearSelectedProjectData();
      return;
    }

    try {
      const projects = await listGeneratorProjects();
      generatorProjects.value = [...projects].sort((a, b) => b.updatedAt - a.updatedAt);
      generatorStatus.value = "success";
      generatorMessage.value = `Loaded ${projects.length} generator project(s).`;
      if (projects.length === 0) {
        clearSelectedProjectData();
        return;
      }

      const targetProjectId = projects.some((item) => item.projectId === generatorProjectId.value)
        ? generatorProjectId.value
        : projects[0].projectId;
      await refreshSelectedProject(targetProjectId);
    } catch (error) {
      generatorStatus.value = "error";
      generatorMessage.value = `Load generator projects failed: ${formatError(error)}`;
    }
  }

  async function autoDetectClaudePath() {
    if (!isElectronRuntime()) {
      generatorStatus.value = "error";
      generatorMessage.value = "Auto-detect is only available in Electron runtime.";
      return;
    }

    generatorStatus.value = "loading";
    generatorMessage.value = "Detecting Claude CLI path...";

    try {
      const result = await detectClaudeCli();
      if (result.resolvedPath) {
        claudeCliPath.value = result.resolvedPath;
        generatorStatus.value = "success";
        generatorMessage.value = `Detected: ${result.resolvedPath}${result.version ? ` (${result.version})` : ""}`;
        return;
      }
      generatorStatus.value = "error";
      generatorMessage.value = "No Claude CLI found. Please set the path manually.";
    } catch (error) {
      generatorStatus.value = "error";
      generatorMessage.value = `Detect failed: ${formatError(error)}`;
    }
  }

  async function saveClaudePathConfig() {
    if (!isElectronRuntime()) {
      generatorStatus.value = "error";
      generatorMessage.value = "Save is only available in Electron runtime.";
      return;
    }

    generatorStatus.value = "loading";
    generatorMessage.value = "Saving Claude CLI path...";

    try {
      const saved = await saveGeneratorSettings({
        claudeCliPath: claudeCliPath.value.trim(),
        verifyCommand: verifyCommand.value.trim(),
      });
      claudeCliPath.value = saved.claudeCliPath;
      verifyCommand.value = saved.verifyCommand;
      generatorStatus.value = "success";
      generatorMessage.value = "Generator settings saved.";
    } catch (error) {
      generatorStatus.value = "error";
      generatorMessage.value = `Save failed: ${formatError(error)}`;
    }
  }

  async function createNewGeneratorProject() {
    if (!isElectronRuntime()) {
      generatorStatus.value = "error";
      generatorMessage.value = "Project create is only available in Electron runtime.";
      return;
    }

    generatorStatus.value = "loading";
    generatorMessage.value = "Creating generator project...";
    try {
      const detail = await createGeneratorProject(generatorProjectName.value.trim() || undefined);
      generatorProjectName.value = "";
      generatorProject.value = detail;
      generatorProjectId.value = detail.projectId;
      upsertProjectSummary(toSummary(detail));
      const selectedFile = syncSelectedFilePath(detail);
      if (selectedFile) {
        await openGeneratorProjectFile(selectedFile);
      }
      await loadGeneratorProjects();
      generatorStatus.value = "success";
      generatorMessage.value = `Project created: ${detail.projectId}`;
    } catch (error) {
      generatorStatus.value = "error";
      generatorMessage.value = `Create project failed: ${formatError(error)}`;
    }
  }

  async function startEmbeddedTerminal() {
    if (!isElectronRuntime()) {
      generatorTerminalStatus.value = "error";
      generatorTerminalMessage.value = "Terminal is only available in Electron runtime.";
      return;
    }
    if (!generatorProjectId.value) {
      generatorTerminalStatus.value = "error";
      generatorTerminalMessage.value = "Please select a project first.";
      return;
    }

    generatorTerminalStatus.value = "loading";
    generatorTerminalMessage.value = "Starting terminal...";
    try {
      const projectId = generatorProjectId.value;
      generatorTerminal.value = await startGeneratorProjectTerminal(projectId);
      attachGeneratorTerminalSubscription(projectId);

      const launchCommand = buildClaudeLaunchCommand(
        claudeCliPath.value,
        generatorTerminal.value.shellCommand,
      );
      try {
        generatorTerminal.value = await sendGeneratorProjectTerminalInput(
          projectId,
          launchCommand,
          true,
        );
        generatorTerminalStatus.value = "success";
        generatorTerminalMessage.value = `Terminal started and launched: ${launchCommand}`;
      } catch (error) {
        generatorTerminalStatus.value = "error";
        generatorTerminalMessage.value = `Terminal started, but Claude launch failed: ${formatError(error)}`;
      }
    } catch (error) {
      generatorTerminalStatus.value = "error";
      generatorTerminalMessage.value = `Start terminal failed: ${formatError(error)}`;
    }
  }

  async function stopEmbeddedTerminal() {
    if (!isElectronRuntime() || !generatorProjectId.value) {
      return;
    }

    generatorTerminalStatus.value = "loading";
    generatorTerminalMessage.value = "Stopping terminal...";
    try {
      generatorTerminal.value = await stopGeneratorProjectTerminal(generatorProjectId.value);
      generatorTerminalStatus.value = "success";
      generatorTerminalMessage.value = "Terminal stopped.";
    } catch (error) {
      generatorTerminalStatus.value = "error";
      generatorTerminalMessage.value = `Stop terminal failed: ${formatError(error)}`;
    }
  }

  async function sendEmbeddedTerminalData(data: string, appendNewline = false) {
    if (!isElectronRuntime() || !generatorProjectId.value || !generatorTerminal.value.running) {
      return;
    }
    if (!data) {
      return;
    }

    try {
      generatorTerminal.value = await sendGeneratorProjectTerminalInput(
        generatorProjectId.value,
        data,
        appendNewline,
      );
    } catch (error) {
      generatorTerminalStatus.value = "error";
      generatorTerminalMessage.value = `Send terminal data failed: ${formatError(error)}`;
    }
  }

  async function resizeEmbeddedTerminal(cols: number, rows: number) {
    if (!isElectronRuntime() || !generatorProjectId.value) {
      return;
    }

    try {
      generatorTerminal.value = await resizeGeneratorProjectTerminal(
        generatorProjectId.value,
        cols,
        rows,
      );
    } catch {
      // Ignore resize errors from transient layout.
    }
  }

  function applyValidationResult(result: GeneratorValidationResult) {
    generatorValidationResult.value = result;
    const errorCount = result.errors.length;
    const warningCount = result.warnings.length;
    if (errorCount > 0) {
      generatorValidationStatus.value = "error";
      generatorValidationMessage.value = `Validation failed with ${errorCount} error(s) and ${warningCount} warning(s).`;
      return;
    }
    generatorValidationStatus.value = "success";
    generatorValidationMessage.value = `Validation passed with ${warningCount} warning(s).`;
  }

  function applyVerifyResult(result: GeneratorVerifyResult) {
    generatorVerifyResult.value = result;
    if (result.success) {
      generatorVerifyStatus.value = "success";
      generatorVerifyMessage.value = `Verify passed (${result.command}) in ${result.durationMs} ms.`;
      return;
    }
    generatorVerifyStatus.value = "error";
    generatorVerifyMessage.value = `Verify failed (${result.command}) with exit code ${result.exitCode ?? "null"}.`;
  }

  function handleStructuredGeneratorError(error: unknown): boolean {
    const validationPayload = parseGeneratorPayloadError<{
      validation?: GeneratorValidationResult;
      message?: string;
    }>(error, GENERATOR_VALIDATION_ERROR_PREFIX);
    if (validationPayload?.validation) {
      applyValidationResult(validationPayload.validation);
      generatorStatus.value = "error";
      generatorMessage.value =
        validationPayload.message ||
        "Install blocked by project validation errors.";
      return true;
    }

    const verifyPayload = parseGeneratorPayloadError<{
      verify?: GeneratorVerifyResult;
      message?: string;
    }>(error, GENERATOR_VERIFY_ERROR_PREFIX);
    if (verifyPayload?.verify) {
      applyVerifyResult(verifyPayload.verify);
      generatorStatus.value = "error";
      generatorMessage.value =
        verifyPayload.message ||
        "Install blocked because verify command failed.";
      return true;
    }

    return false;
  }

  async function runGeneratorProjectValidation() {
    if (!isElectronRuntime()) {
      generatorValidationStatus.value = "error";
      generatorValidationMessage.value = "Validation is only available in Electron runtime.";
      return;
    }
    if (!generatorProjectId.value) {
      generatorValidationStatus.value = "error";
      generatorValidationMessage.value = "Please select a project first.";
      return;
    }

    generatorValidationStatus.value = "loading";
    generatorValidationMessage.value = "Running validation checks...";
    try {
      const result = await validateGeneratorProject(
        generatorProjectId.value,
        generatorTabId.value,
      );
      applyValidationResult(result);
      generatorStatus.value = result.ok ? "success" : "error";
      generatorMessage.value = result.ok
        ? "Validation completed."
        : "Validation failed. Fix errors before install.";
    } catch (error) {
      generatorValidationStatus.value = "error";
      generatorValidationMessage.value = `Validation failed: ${formatError(error)}`;
      generatorStatus.value = "error";
      generatorMessage.value = `Validation failed: ${formatError(error)}`;
    }
  }

  async function runGeneratorProjectVerifyCheck() {
    if (!isElectronRuntime()) {
      generatorVerifyStatus.value = "error";
      generatorVerifyMessage.value = "Verify is only available in Electron runtime.";
      return;
    }
    if (!generatorProjectId.value) {
      generatorVerifyStatus.value = "error";
      generatorVerifyMessage.value = "Please select a project first.";
      return;
    }

    generatorVerifyStatus.value = "loading";
    generatorVerifyMessage.value = "Running verify command...";
    try {
      const result = await runGeneratorProjectVerifyBridge(
        generatorProjectId.value,
        verifyCommand.value.trim(),
      );
      applyVerifyResult(result);
      generatorStatus.value = result.success ? "success" : "error";
      generatorMessage.value = result.success
        ? "Verify completed."
        : "Verify failed. Install is blocked.";
    } catch (error) {
      const fallback = createVerifyResultFromError(
        generatorProjectId.value,
        verifyCommand.value.trim() || "verify",
        `Verify failed: ${formatError(error)}`,
      );
      applyVerifyResult(fallback);
      generatorStatus.value = "error";
      generatorMessage.value = `Verify failed: ${formatError(error)}`;
    }
  }

  async function updateGeneratorProjectAgentsRules() {
    if (!isElectronRuntime()) {
      generatorStatus.value = "error";
      generatorMessage.value = "Update AGENTS.md is only available in Electron runtime.";
      return;
    }
    if (!generatorProjectId.value) {
      generatorStatus.value = "error";
      generatorMessage.value = "Please select a project first.";
      return;
    }

    generatorStatus.value = "loading";
    generatorMessage.value = "Updating AGENTS.md from template...";
    try {
      const result = await updateGeneratorProjectAgents(generatorProjectId.value);
      generatorProject.value = result.project;
      generatorProjectId.value = result.project.projectId;
      upsertProjectSummary(toSummary(result.project));

      const updatedFilePath = String(result.filePath ?? "AGENTS.md")
        .trim()
        .replace(/\\/g, "/");
      if (updatedFilePath) {
        await openGeneratorProjectFile(updatedFilePath);
      }

      generatorStatus.value = "success";
      generatorMessage.value = `Updated ${updatedFilePath || "AGENTS.md"} in selected project.`;
    } catch (error) {
      generatorStatus.value = "error";
      generatorMessage.value = `Update AGENTS.md failed: ${formatError(error)}`;
    }
  }

  async function executeInstall(overwriteExisting: boolean) {
    return installGeneratorProjectApp(
      generatorProjectId.value,
      generatorTabId.value,
      overwriteExisting,
      verifyCommand.value.trim(),
    );
  }

  async function installAppFromGeneratorProject() {
    if (!isElectronRuntime()) {
      generatorStatus.value = "error";
      generatorMessage.value = "Install is only available in Electron runtime.";
      return;
    }

    syncGeneratorTabIdWithTabs();
    if (!generatorTabId.value) {
      generatorStatus.value = "error";
      generatorMessage.value = "Please choose a target tab.";
      return;
    }
    if (!generatorProjectId.value) {
      generatorStatus.value = "error";
      generatorMessage.value = "Please select a project first.";
      return;
    }

    generatorStatus.value = "loading";
    generatorMessage.value = "Installing app from selected project...";

    try {
      const result = await executeInstall(false);
      generatorProject.value = result.project;
      upsertProjectSummary(toSummary(result.project));
      applyValidationResult(result.validation);
      applyVerifyResult(result.verify);
      await loadGeneratorProjects();
      options.onInstalled?.({
        apps: result.installedApps,
        generatedAppId: result.generatedAppId,
        tabId: generatorTabId.value,
      });
      generatorStatus.value = "success";
      generatorMessage.value = "Project app installed successfully.";
    } catch (error) {
      if (handleStructuredGeneratorError(error)) {
        return;
      }
      const existingAppId = parseAlreadyInstalledAppId(error);
      if (existingAppId !== null) {
        const displayId = existingAppId || "this app";
        const shouldOverwrite = window.confirm(
          `App "${displayId}" is already installed. Overwrite existing installation?`,
        );
        if (!shouldOverwrite) {
          generatorStatus.value = "idle";
          generatorMessage.value = "Install canceled.";
          return;
        }

        generatorStatus.value = "loading";
        generatorMessage.value = `Overwriting app "${displayId}"...`;
        try {
          const result = await executeInstall(true);
          generatorProject.value = result.project;
          upsertProjectSummary(toSummary(result.project));
          applyValidationResult(result.validation);
          applyVerifyResult(result.verify);
          await loadGeneratorProjects();
          options.onInstalled?.({
            apps: result.installedApps,
            generatedAppId: result.generatedAppId,
            tabId: generatorTabId.value,
          });
          generatorStatus.value = "success";
          generatorMessage.value = "Project app overwritten successfully.";
          return;
        } catch (overwriteError) {
          if (handleStructuredGeneratorError(overwriteError)) {
            return;
          }
          generatorStatus.value = "error";
          generatorMessage.value = `Overwrite failed: ${formatError(overwriteError)}`;
          return;
        }
      }

      generatorStatus.value = "error";
      generatorMessage.value = `Install failed: ${formatError(error)}`;
    }
  }

  return {
    autoDetectClaudePath,
    claudeCliPath,
    createNewGeneratorProject,
    generatorFileContent,
    generatorFileLoading,
    generatorFilePath,
    generatorFileTruncated,
    generatorMessage,
    generatorProject,
    generatorProjectId,
    generatorProjectName,
    generatorProjects,
    generatorStatus,
    generatorTabId,
    generatorValidationMessage,
    generatorValidationResult,
    generatorValidationStatus,
    generatorVerifyMessage,
    generatorVerifyResult,
    generatorVerifyStatus,
    generatorTerminal,
    generatorTerminalMessage,
    generatorTerminalStatus,
    installAppFromGeneratorProject,
    loadGeneratorProjects,
    loadGeneratorSettingsFromStorage,
    loadGeneratorTerminalState,
    openGeneratorProjectFile,
    runGeneratorProjectValidation,
    runGeneratorProjectVerifyCheck,
    updateGeneratorProjectAgentsRules,
    saveClaudePathConfig,
    selectGeneratorProject,
    startEmbeddedTerminal,
    detachGeneratorTerminalSubscription,
    stopEmbeddedTerminal,
    sendEmbeddedTerminalData,
    resizeEmbeddedTerminal,
    syncGeneratorTabIdWithTabs,
    verifyCommand,
  };
}
