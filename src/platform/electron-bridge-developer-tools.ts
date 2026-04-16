import type {
  DeveloperToolsAnalyzeResult,
  DeveloperToolsLaunchState,
  DeveloperToolsTransformId,
  DeveloperToolsTransformResult,
} from "../types/developer-tools";
import { getApi } from "./electron-bridge-runtime";

export function analyzeDeveloperToolsText(
  text: string,
): Promise<DeveloperToolsAnalyzeResult> {
  return getApi().analyzeDeveloperToolsText(text);
}

export function runDeveloperToolsTransform(
  text: string,
  transformId: DeveloperToolsTransformId,
): Promise<DeveloperToolsTransformResult> {
  return getApi().runDeveloperToolsTransform(text, transformId);
}

export function getDeveloperToolsLaunchState(): Promise<DeveloperToolsLaunchState> {
  return getApi().getDeveloperToolsLaunchState();
}

export function subscribeDeveloperToolsLaunch(
  callback: (state: DeveloperToolsLaunchState) => void,
): () => void {
  return getApi().subscribeDeveloperToolsLaunch(callback);
}
