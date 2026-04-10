export type AiChatApiType = "chat-completions" | "responses";
export type AiChatProvider = "openai-sdk" | "anthropic-sdk";

export interface AiChatSettings {
  provider: AiChatProvider;
  apiType: AiChatApiType;
  debugEnabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AiChatModelOption {
  id: string;
  ownedBy?: string;
}

export interface AiChatImageAttachment {
  id: string;
  dataUrl: string;
  mimeType: string;
}

export interface AiChatSessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export type AiChatMessageRole = "user" | "assistant" | "system";
export type AiChatMessageStatus = "complete" | "streaming" | "error";

export interface AiChatMessage {
  id: string;
  sessionId: string;
  role: AiChatMessageRole;
  content: string;
  attachments: AiChatImageAttachment[];
  responseId: string | null;
  status: AiChatMessageStatus;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AiChatLaunchState {
  payload: string | null;
  source: "manual" | "quick-launcher";
  requestId: string;
  updatedAt: number;
}

export interface SendAiChatMessageInput {
  sessionId?: string;
  message: string;
  attachments?: AiChatImageAttachment[];
  attachmentsJson?: string;
  source?: "manual" | "quick-launcher";
}

export interface SendAiChatMessageResult {
  requestId: string;
  session: AiChatSessionSummary;
  userMessage: AiChatMessage;
  assistantMessage: AiChatMessage;
}

export interface AiChatStreamEvent {
  requestId: string;
  sessionId: string;
  messageId: string;
  type: "start" | "delta" | "done" | "error" | "canceled";
  delta?: string;
  error?: string;
}
