import type {
  ClaudeCliDetectionResult,
  GeneratorProjectAgentsUpdateResult,
  GeneratorInstallResult,
  GeneratorProjectDetail,
  GeneratorProjectFileContent,
  GeneratorProjectSummary,
  GeneratorSettings,
  GeneratorTerminalState,
  GeneratorValidationResult,
  GeneratorVerifyResult,
} from "../types/generator";
import { getApi } from "./electron-bridge-runtime";

export function getGeneratorSettings(): Promise<GeneratorSettings> {
  return getApi().getGeneratorSettings();
}

export function saveGeneratorSettings(input: GeneratorSettings): Promise<GeneratorSettings> {
  return getApi().saveGeneratorSettings(input);
}

export function detectClaudeCli(): Promise<ClaudeCliDetectionResult> {
  return getApi().detectClaudeCli();
}

export function createGeneratorProject(projectName?: string): Promise<GeneratorProjectDetail> {
  return getApi().createGeneratorProject(projectName);
}

export function getGeneratorProject(projectId: string): Promise<GeneratorProjectDetail> {
  return getApi().getGeneratorProject(projectId);
}

export function listGeneratorProjects(): Promise<GeneratorProjectSummary[]> {
  return getApi().listGeneratorProjects();
}

export function readGeneratorProjectFile(
  projectId: string,
  filePath: string,
): Promise<GeneratorProjectFileContent> {
  return getApi().readGeneratorProjectFile(projectId, filePath);
}

export function updateGeneratorProjectAgents(
  projectId: string,
): Promise<GeneratorProjectAgentsUpdateResult> {
  return getApi().updateGeneratorProjectAgents(projectId);
}

export function installGeneratorProjectApp(
  projectId: string,
  tabId: string,
  overwriteExisting = false,
  verifyCommandOverride = "",
): Promise<GeneratorInstallResult> {
  return getApi().installGeneratorProjectApp(
    projectId,
    tabId,
    overwriteExisting,
    verifyCommandOverride,
  );
}

export function validateGeneratorProject(
  projectId: string,
  tabId?: string,
): Promise<GeneratorValidationResult> {
  return getApi().validateGeneratorProject(projectId, tabId);
}

export function runGeneratorProjectVerify(
  projectId: string,
  commandOverride?: string,
): Promise<GeneratorVerifyResult> {
  return getApi().runGeneratorProjectVerify(projectId, commandOverride);
}

export function getGeneratorProjectTerminal(projectId: string): Promise<GeneratorTerminalState> {
  return getApi().getGeneratorProjectTerminal(projectId);
}

export function startGeneratorProjectTerminal(projectId: string): Promise<GeneratorTerminalState> {
  return getApi().startGeneratorProjectTerminal(projectId);
}

export function sendGeneratorProjectTerminalInput(
  projectId: string,
  text: string,
  appendNewline = true,
): Promise<GeneratorTerminalState> {
  return getApi().sendGeneratorProjectTerminalInput(projectId, text, appendNewline);
}

export function stopGeneratorProjectTerminal(projectId: string): Promise<GeneratorTerminalState> {
  return getApi().stopGeneratorProjectTerminal(projectId);
}

export function resizeGeneratorProjectTerminal(
  projectId: string,
  cols: number,
  rows: number,
): Promise<GeneratorTerminalState> {
  return getApi().resizeGeneratorProjectTerminal(projectId, cols, rows);
}

export function subscribeGeneratorProjectTerminal(
  projectId: string,
  callback: (state: GeneratorTerminalState) => void,
): () => void {
  return getApi().subscribeGeneratorProjectTerminal(projectId, callback);
}
