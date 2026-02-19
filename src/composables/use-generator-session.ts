import { ref, type Ref } from "vue";
import type { InstalledApp } from "../types/app";
import type {
  GeneratorProjectDetail,
  GeneratorProjectSummary,
  GeneratorTerminalState,
} from "../types/generator";
import type { TabDefinition } from "../types/settings";
import {
  createGeneratorProject,
  detectClaudeCli,
  generatorChatInProject,
  getGeneratorProjectTerminal,
  getGeneratorProject,
  getGeneratorSettings,
  installGeneratorProjectApp,
  isElectronRuntime,
  listGeneratorProjects,
  readGeneratorProjectFile,
  resizeGeneratorProjectTerminal,
  saveGeneratorSettings,
  sendGeneratorProjectTerminalInput,
  subscribeGeneratorProjectTerminal,
  startGeneratorProjectTerminal,
  stopGeneratorProjectTerminal,
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

function toSummary(project: GeneratorProjectDetail): GeneratorProjectSummary {
  return {
    projectId: project.projectId,
    projectDir: project.projectDir,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    running: project.running,
    runningOutput: project.runningOutput,
    messageCount: project.messageCount,
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
    startedAt: null,
    updatedAt: t,
    lastExitCode: null,
    shellCommand: "",
    cols: 120,
    rows: 36,
  };
}

export function useGeneratorSession(options: UseGeneratorSessionOptions) {
  const generatorStatus = ref<"idle" | "loading" | "success" | "error">("idle");
  const generatorMessage = ref("Use Claude CLI to edit files in generator projects.");
  const claudeCliPath = ref("");
  const generatorInput = ref("");
  const generatorProjectName = ref("");
  const generatorTabId = ref(options.tabs.value[0]?.id ?? "workspace");

  const generatorProjects = ref<GeneratorProjectSummary[]>([]);
  const generatorProjectId = ref("");
  const generatorProject = ref<GeneratorProjectDetail | null>(null);

  const generatorFilePath = ref("");
  const generatorFileContent = ref("");
  const generatorFileTruncated = ref(false);
  const generatorFileLoading = ref(false);
  const generatorTerminal = ref<GeneratorTerminalState>(emptyTerminalState(""));
  const generatorTerminalInput = ref("");
  const generatorTerminalStatus = ref<"idle" | "loading" | "success" | "error">("idle");
  const generatorTerminalMessage = ref("Embedded terminal is ready.");

  let generatorProjectPollingTimer: ReturnType<typeof setInterval> | null = null;
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
    generatorTerminal.value = emptyTerminalState("");
    generatorTerminalInput.value = "";
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
      generatorStatus.value = "idle";
      generatorMessage.value = settings.claudeCliPath
        ? "Claude CLI path loaded from local settings."
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
      if (projects.length === 0) {
        clearSelectedProjectData();
        return;
      }

      const targetProjectId = projects.some((item) => item.projectId === generatorProjectId.value)
        ? generatorProjectId.value
        : projects[0].projectId;
      await refreshSelectedProject(targetProjectId);
    } catch {
      generatorProjects.value = [];
      clearSelectedProjectData();
    }
  }

  function stopGeneratorProjectPolling() {
    if (generatorProjectPollingTimer) {
      clearInterval(generatorProjectPollingTimer);
      generatorProjectPollingTimer = null;
    }
  }

  function startGeneratorProjectPolling(projectId: string) {
    stopGeneratorProjectPolling();
    generatorProjectPollingTimer = setInterval(() => {
      void getGeneratorProject(projectId)
        .then((detail) => {
          generatorProject.value = detail;
          upsertProjectSummary(toSummary(detail));
          syncSelectedFilePath(detail);
        })
        .catch(() => {
          // Ignore polling errors during transient CLI execution
        });
    }, 800);
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
      const saved = await saveGeneratorSettings({ claudeCliPath: claudeCliPath.value.trim() });
      claudeCliPath.value = saved.claudeCliPath;
      generatorStatus.value = "success";
      generatorMessage.value = saved.claudeCliPath
        ? "Claude CLI path saved."
        : "Claude CLI path cleared.";
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

  async function sendGeneratorMessage() {
    if (!isElectronRuntime()) {
      generatorStatus.value = "error";
      generatorMessage.value = "Chat is only available in Electron runtime.";
      return;
    }
    if (!generatorProjectId.value) {
      generatorStatus.value = "error";
      generatorMessage.value = "Please select or create a generator project first.";
      return;
    }

    const message = generatorInput.value.trim();
    if (!message) {
      generatorStatus.value = "error";
      generatorMessage.value = "Please enter your requirement first.";
      return;
    }

    generatorInput.value = "";
    generatorStatus.value = "loading";
    generatorMessage.value = "Claude is editing project files...";

    const projectId = generatorProjectId.value;
    try {
      startGeneratorProjectPolling(projectId);
      const result = await generatorChatInProject(
        projectId,
        message,
        claudeCliPath.value.trim() || undefined,
      );
      generatorProject.value = result.project;
      upsertProjectSummary(toSummary(result.project));
      const selectedFile = syncSelectedFilePath(result.project);
      if (selectedFile) {
        await openGeneratorProjectFile(selectedFile);
      }
      await loadGeneratorProjects();
      generatorStatus.value = "success";
      generatorMessage.value = `Claude replied via ${result.cliPath}.`;
    } catch (error) {
      generatorStatus.value = "error";
      generatorMessage.value = `Chat failed: ${formatError(error)}`;
    } finally {
      stopGeneratorProjectPolling();
      try {
        await refreshSelectedProject(projectId);
      } catch {
        // Ignore refresh failures after chat completion
      }
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
      generatorTerminal.value = await startGeneratorProjectTerminal(generatorProjectId.value);
      attachGeneratorTerminalSubscription(generatorProjectId.value);
      generatorTerminalStatus.value = "success";
      generatorTerminalMessage.value = "Terminal started.";
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

  async function sendEmbeddedTerminalCommand() {
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
    if (!generatorTerminal.value.running) {
      generatorTerminalStatus.value = "error";
      generatorTerminalMessage.value = "Terminal is not running. Start it first.";
      return;
    }

    const commandText = generatorTerminalInput.value.trim();
    if (!commandText) {
      return;
    }

    generatorTerminalInput.value = "";
    generatorTerminalStatus.value = "loading";
    generatorTerminalMessage.value = "Sending command...";
    try {
      generatorTerminal.value = await sendGeneratorProjectTerminalInput(
        generatorProjectId.value,
        commandText,
        true,
      );
      generatorTerminalStatus.value = "success";
      generatorTerminalMessage.value = "Command sent.";
    } catch (error) {
      generatorTerminalStatus.value = "error";
      generatorTerminalMessage.value = `Send command failed: ${formatError(error)}`;
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
      const result = await installGeneratorProjectApp(generatorProjectId.value, generatorTabId.value);
      generatorProject.value = result.project;
      upsertProjectSummary(toSummary(result.project));
      await loadGeneratorProjects();
      options.onInstalled?.({
        apps: result.installedApps,
        generatedAppId: result.generatedAppId,
        tabId: generatorTabId.value,
      });
      generatorStatus.value = "success";
      generatorMessage.value = "Project app installed successfully.";
    } catch (error) {
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
    generatorInput,
    generatorMessage,
    generatorProject,
    generatorProjectId,
    generatorProjectName,
    generatorProjects,
    generatorStatus,
    generatorTabId,
    generatorTerminal,
    generatorTerminalInput,
    generatorTerminalMessage,
    generatorTerminalStatus,
    installAppFromGeneratorProject,
    loadGeneratorProjects,
    loadGeneratorSettingsFromStorage,
    loadGeneratorTerminalState,
    openGeneratorProjectFile,
    saveClaudePathConfig,
    selectGeneratorProject,
    sendGeneratorMessage,
    sendEmbeddedTerminalCommand,
    startEmbeddedTerminal,
    stopGeneratorProjectPolling,
    detachGeneratorTerminalSubscription,
    stopEmbeddedTerminal,
    sendEmbeddedTerminalData,
    resizeEmbeddedTerminal,
    syncGeneratorTabIdWithTabs,
  };
}
