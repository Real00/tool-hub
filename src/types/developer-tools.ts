export type DeveloperToolsTransformId =
  | "json-format"
  | "md5-hash"
  | "random-generate"
  | "url-decode"
  | "url-encode"
  | "unicode-decode"
  | "unicode-encode"
  | "base64-decode"
  | "base64-encode"
  | "timestamp-convert";

export interface DeveloperToolsAnalyzeResult {
  rawText: string;
  detectedTransforms: DeveloperToolsTransformId[];
  suggestedTransform: DeveloperToolsTransformId | null;
}

export interface DeveloperToolsTransformResult {
  transformId: DeveloperToolsTransformId;
  outputText: string;
}

export interface DeveloperToolsLaunchPayload {
  source: "manual" | "quick-launcher";
  inputText: string;
  suggestedTransform?: DeveloperToolsTransformId | null;
}

export interface DeveloperToolsLaunchState {
  payload: string | null;
  source: "manual" | "quick-launcher";
  requestId: string;
  updatedAt: number;
}

export interface QuickLauncherClipboardDeveloperToolsAction {
  id: DeveloperToolsTransformId;
  label: string;
  description: string;
  suggestedTransform: DeveloperToolsTransformId;
}

export interface QuickLauncherClipboardDeveloperToolsContext {
  rawText: string;
  suggestedTransform: DeveloperToolsTransformId | null;
  actions: QuickLauncherClipboardDeveloperToolsAction[];
}
