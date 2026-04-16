import type {
  AiChatLaunchState,
  AiChatMessage,
  AiChatModelOption,
  AiChatSessionSummary,
  AiChatSettings,
  AiChatStreamEvent,
  SendAiChatMessageInput,
  SendAiChatMessageResult,
} from "../types/ai-chat";
import { getApi } from "./electron-bridge-runtime";

export function getAiChatSettings(): Promise<AiChatSettings> {
  return getApi().getAiChatSettings();
}

export function saveAiChatSettings(input: AiChatSettings): Promise<AiChatSettings> {
  return getApi().saveAiChatSettings(input);
}

export function listAiChatModels(
  input: Pick<AiChatSettings, "provider" | "baseUrl" | "apiKey">,
): Promise<AiChatModelOption[]> {
  return getApi().listAiChatModels(input);
}

export function listAiChatSessions(): Promise<AiChatSessionSummary[]> {
  return getApi().listAiChatSessions();
}

export function createAiChatSession(): Promise<AiChatSessionSummary> {
  return getApi().createAiChatSession();
}

export function deleteAiChatSession(sessionId: string): Promise<boolean> {
  return getApi().deleteAiChatSession(sessionId);
}

export function getAiChatSessionMessages(sessionId: string): Promise<AiChatMessage[]> {
  return getApi().getAiChatSessionMessages(sessionId);
}

export function sendAiChatMessage(
  input: SendAiChatMessageInput,
): Promise<SendAiChatMessageResult> {
  return getApi().sendAiChatMessage(input);
}

export function beginAiChatStream(requestId: string): Promise<boolean> {
  return getApi().beginAiChatStream(requestId);
}

export function cancelAiChatStream(requestId: string): Promise<boolean> {
  return getApi().cancelAiChatStream(requestId);
}

export function getAiChatLaunchState(): Promise<AiChatLaunchState> {
  return getApi().getAiChatLaunchState();
}

export function subscribeAiChatStream(
  callback: (event: AiChatStreamEvent) => void,
): () => void {
  return getApi().subscribeAiChatStream(callback);
}

export function subscribeAiChatLaunch(
  callback: (state: AiChatLaunchState) => void,
): () => void {
  return getApi().subscribeAiChatLaunch(callback);
}
