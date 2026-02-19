import type { InstalledApp } from "./app";

export interface GeneratorSettings {
  claudeCliPath: string;
}

export interface ClaudeCliDetectionResult {
  configuredPath: string;
  resolvedPath: string | null;
  version: string | null;
  source: "configured" | "detected" | "none";
  candidates: string[];
}

export interface GeneratorMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

export interface GeneratorProjectFileEntry {
  path: string;
  type: "file" | "directory";
  size: number;
  modifiedAt: number;
}

export interface GeneratorProjectSummary {
  projectId: string;
  projectDir: string;
  createdAt: number;
  updatedAt: number;
  running: boolean;
  runningOutput: string;
  messageCount: number;
  fileCount: number;
  hasManifest: boolean;
  appId: string | null;
  appName: string | null;
  version: string | null;
}

export interface GeneratorProjectDetail extends GeneratorProjectSummary {
  messages: GeneratorMessage[];
  files: GeneratorProjectFileEntry[];
}

export interface GeneratorProjectFileContent {
  projectId: string;
  filePath: string;
  content: string;
  truncated: boolean;
}

export interface GeneratorChatResult {
  cliPath: string;
  assistantMessage: string;
  rawOutput: {
    stdout: string;
    stderr: string;
  };
  project: GeneratorProjectDetail;
}

export interface GeneratorInstallResult {
  generatedAppId: string;
  installedApps: InstalledApp[];
  project: GeneratorProjectDetail;
}

export interface GeneratorTerminalState {
  projectId: string;
  running: boolean;
  output: string;
  outputSeq: number;
  lastChunk: string;
  startedAt: number | null;
  updatedAt: number;
  lastExitCode: number | null;
  shellCommand: string;
  cols: number;
  rows: number;
}
