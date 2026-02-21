import type { InstalledApp } from "./app";

export interface GeneratorSettings {
  claudeCliPath: string;
  verifyCommand: string;
}

export interface ClaudeCliDetectionResult {
  configuredPath: string;
  resolvedPath: string | null;
  version: string | null;
  source: "configured" | "detected" | "none";
  candidates: string[];
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
  fileCount: number;
  hasManifest: boolean;
  appId: string | null;
  appName: string | null;
  version: string | null;
}

export interface GeneratorProjectDetail extends GeneratorProjectSummary {
  files: GeneratorProjectFileEntry[];
}

export interface GeneratorProjectFileContent {
  projectId: string;
  filePath: string;
  content: string;
  truncated: boolean;
}

export interface GeneratorValidationIssue {
  code: string;
  level: "error" | "warning";
  message: string;
  path?: string;
}

export interface GeneratorValidationCheck {
  code: string;
  status: "pass" | "error" | "warning";
  message: string;
  path?: string;
}

export interface GeneratorValidationResult {
  projectId: string;
  validatedAt: number;
  ok: boolean;
  errors: GeneratorValidationIssue[];
  warnings: GeneratorValidationIssue[];
  checks: GeneratorValidationCheck[];
  manifestPath: string;
  normalizedAppId: string | null;
  targetTabId: string | null;
}

export interface GeneratorVerifyResult {
  projectId: string;
  command: string;
  success: boolean;
  exitCode: number | null;
  output: string;
  truncated: boolean;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
}

export interface GeneratorInstallResult {
  generatedAppId: string;
  installedApps: InstalledApp[];
  project: GeneratorProjectDetail;
  validation: GeneratorValidationResult;
  verify: GeneratorVerifyResult;
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
