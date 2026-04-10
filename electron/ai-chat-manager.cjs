const crypto = require("node:crypto");

const DEFAULT_AI_CHAT_TITLE = "New Chat";
const AI_CHAT_STREAM_CHANNEL = "ai-chat:stream";
const PENDING_REQUEST_TTL_MS = 15000;
const AI_CHAT_DEBUG_ENABLED_BY_ENV =
  process.env.TOOL_HUB_AI_DEBUG === "1" || process.env.TOOL_HUB_AI_DEBUG === "true";

function createAiChatManager(options = {}) {
  const getSettingsStore =
    typeof options.getSettingsStore === "function"
      ? options.getSettingsStore
      : () => {
          throw new Error("getSettingsStore is required.");
        };

  const activeRequests = new Map();
  const pendingRequests = new Map();
  const subscribers = new Set();

  function createId() {
    return crypto.randomUUID();
  }

  function normalizeText(input) {
    return String(input ?? "").trim();
  }

  function normalizeAttachments(input) {
    if (!Array.isArray(input)) {
      return [];
    }
    return input
      .map((item) => ({
        id: normalizeText(item?.id),
        dataUrl: normalizeText(item?.dataUrl),
        mimeType: normalizeText(item?.mimeType),
      }))
      .filter((item) => item.id && item.dataUrl && item.mimeType);
  }

  function normalizeAttachmentsInput(input) {
    const directAttachments = normalizeAttachments(input?.attachments);
    if (directAttachments.length > 0) {
      return directAttachments;
    }
    const attachmentsJson = normalizeText(input?.attachmentsJson);
    if (!attachmentsJson) {
      return [];
    }
    try {
      return normalizeAttachments(JSON.parse(attachmentsJson));
    } catch {
      return [];
    }
  }

  function deriveSessionTitle(input) {
    const value = normalizeText(input).replace(/\s+/g, " ");
    if (!value) {
      return DEFAULT_AI_CHAT_TITLE;
    }
    return value.length > 48 ? `${value.slice(0, 48)}...` : value;
  }

  function normalizeBaseUrl(input) {
    return normalizeText(input).replace(/\/+$/, "");
  }

  function normalizeApiType(input) {
    return String(input ?? "").trim().toLowerCase() === "responses"
      ? "responses"
      : "chat-completions";
  }

  function isDebugEnabled(input) {
    return AI_CHAT_DEBUG_ENABLED_BY_ENV || input?.debugEnabled === true;
  }

  function debugLog(label, payload, debugInput) {
    if (!isDebugEnabled(debugInput)) {
      return;
    }
    try {
      const serialized =
        typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
      console.log(`[ai-chat] ${label}: ${serialized}`);
    } catch {
      console.log(`[ai-chat] ${label}:`, payload);
    }
  }

  function truncateText(input, limit = 1200) {
    const value = String(input ?? "");
    if (value.length <= limit) {
      return value;
    }
    return `${value.slice(0, limit)}...`;
  }

  function sanitizeRequestBody(body) {
    if (!body || typeof body !== "object") {
      return body;
    }
    return JSON.parse(
      JSON.stringify(body, (_key, value) => {
        if (typeof value === "string" && value.length > 400) {
          return truncateText(value, 400);
        }
        return value;
      }),
    );
  }

  function headersToObject(headers) {
    if (!headers) {
      return undefined;
    }
    try {
      if (typeof headers.entries === "function") {
        return Object.fromEntries(Array.from(headers.entries()));
      }
    } catch {
      // Fall through to plain-object handling.
    }
    if (typeof headers === "object") {
      return { ...headers };
    }
    return undefined;
  }

  function expandErrorDetails(error) {
    if (!(error instanceof Error)) {
      return {
        message: String(error),
        raw: error,
      };
    }

    const anyError = error;
    return {
      name: error.name,
      message: error.message,
      status:
        typeof anyError.status === "number"
          ? anyError.status
          : typeof anyError.statusCode === "number"
            ? anyError.statusCode
            : undefined,
      code:
        typeof anyError.code === "string" || typeof anyError.code === "number"
          ? anyError.code
          : undefined,
      type: typeof anyError.type === "string" ? anyError.type : undefined,
      param: typeof anyError.param === "string" ? anyError.param : undefined,
      request_id:
        typeof anyError.request_id === "string"
          ? anyError.request_id
          : typeof anyError.requestId === "string"
            ? anyError.requestId
            : typeof anyError._request_id === "string"
              ? anyError._request_id
              : undefined,
      headers: headersToObject(anyError.headers),
      error: anyError.error,
      cause:
        anyError.cause instanceof Error
          ? {
              name: anyError.cause.name,
              message: anyError.cause.message,
              stack: truncateText(anyError.cause.stack ?? "", 2000),
            }
          : anyError.cause,
      stack: truncateText(error.stack ?? "", 2000),
    };
  }

  function normalizeProvider(input) {
    return String(input ?? "").trim().toLowerCase() === "anthropic-sdk"
      ? "anthropic-sdk"
      : "openai-sdk";
  }

  function tryLoadOpenAiSdk() {
    try {
      const mod = require("openai");
      return mod?.default || mod?.OpenAI || mod;
    } catch {
      return null;
    }
  }

  function tryLoadAnthropicSdk() {
    try {
      const mod = require("@anthropic-ai/sdk");
      return mod?.default || mod?.Anthropic || mod;
    } catch {
      return null;
    }
  }

  function cloneStreamEvent(event) {
    return {
      requestId: String(event.requestId),
      sessionId: String(event.sessionId),
      messageId: String(event.messageId),
      type: String(event.type),
      delta:
        Object.prototype.hasOwnProperty.call(event, "delta") && typeof event.delta === "string"
          ? event.delta
          : undefined,
      error:
        Object.prototype.hasOwnProperty.call(event, "error") && typeof event.error === "string"
          ? event.error
          : undefined,
    };
  }

  function broadcastStreamEvent(event) {
    const payload = cloneStreamEvent(event);
    subscribers.forEach((webContents) => {
      if (!webContents || webContents.isDestroyed()) {
        subscribers.delete(webContents);
        return;
      }
      webContents.send(AI_CHAT_STREAM_CHANNEL, payload);
    });
  }

  function subscribe(webContents) {
    if (!webContents || webContents.isDestroyed()) {
      return;
    }
    subscribers.add(webContents);
    webContents.once("destroyed", () => {
      subscribers.delete(webContents);
    });
  }

  function unsubscribe(webContents) {
    if (!webContents) {
      return;
    }
    subscribers.delete(webContents);
  }

  function extractMessageText(content) {
    if (typeof content === "string") {
      return content;
    }
    if (!Array.isArray(content)) {
      return "";
    }
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item === "object") {
          if (typeof item.text === "string") {
            return item.text;
          }
          if (item.type === "text" && typeof item.value === "string") {
            return item.value;
          }
        }
        return "";
      })
      .join("");
  }

  function extractDeltaText(payload) {
    if (!payload || typeof payload !== "object") {
      return "";
    }
    const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
    if (!choice || typeof choice !== "object") {
      return "";
    }
    const delta = choice.delta;
    if (delta && typeof delta === "object") {
      if (typeof delta.content === "string") {
        return delta.content;
      }
      return extractMessageText(delta.content);
    }
    const message = choice.message;
    if (message && typeof message === "object") {
      if (typeof message.content === "string") {
        return message.content;
      }
      return extractMessageText(message.content);
    }
    return "";
  }

  function extractResponsesOutputText(payload) {
    if (!payload || typeof payload !== "object") {
      return "";
    }
    if (typeof payload.output_text === "string") {
      return payload.output_text;
    }

    const output = Array.isArray(payload.output) ? payload.output : [];
    return output
      .flatMap((item) => {
        if (!item || typeof item !== "object") {
          return [];
        }
        const content = Array.isArray(item.content) ? item.content : [];
        return content.map((entry) => {
          if (!entry || typeof entry !== "object") {
            return "";
          }
          if (typeof entry.text === "string") {
            return entry.text;
          }
          if (typeof entry.content === "string") {
            return entry.content;
          }
          return "";
        });
      })
      .filter(Boolean)
      .join("");
  }

  function extractResponsesDeltaText(payload) {
    if (!payload || typeof payload !== "object") {
      return "";
    }
    if (typeof payload.delta === "string") {
      return payload.delta;
    }
    if (typeof payload.output_text === "string") {
      return payload.output_text;
    }
    return "";
  }

  async function ensureConfigured() {
    const settings = await getSettingsStore().getAiChatSettings();
    const provider = normalizeProvider(settings.provider);
    const apiType = normalizeApiType(settings.apiType);
    const baseUrl = normalizeBaseUrl(settings.baseUrl);
    const apiKey = normalizeText(settings.apiKey);
    const model = normalizeText(settings.model);
    if (!apiKey || !model) {
      throw new Error("AI settings are incomplete. Configure API Key and Model first.");
    }
    return {
      provider,
      apiType,
      debugEnabled: settings.debugEnabled === true,
      baseUrl:
        provider === "anthropic-sdk"
          ? baseUrl
          : baseUrl || "https://api.openai.com/v1",
      apiKey,
      model,
    };
  }

  async function listModels(input) {
    const provider = normalizeProvider(input?.provider);
    const baseUrl = normalizeBaseUrl(input?.baseUrl);
    const apiKey = normalizeText(input?.apiKey);
    if (!apiKey) {
      throw new Error("API Key is required to fetch models.");
    }

    if (provider === "anthropic-sdk") {
      const Anthropic = tryLoadAnthropicSdk();
      if (!Anthropic) {
        throw new Error("Anthropic SDK is not installed. Run pnpm install first.");
      }
      const client = new Anthropic({
        apiKey,
        ...(baseUrl ? { baseURL: baseUrl } : {}),
      });
      const page = await client.models.list();
      const data = Array.isArray(page?.data) ? page.data : [];
      return data
        .map((item) => ({
          id: normalizeText(item?.id),
          ownedBy: "anthropic",
        }))
        .filter((item) => item.id)
        .sort((a, b) => a.id.localeCompare(b.id));
    }

    const OpenAI = tryLoadOpenAiSdk();
    if (OpenAI) {
      const client = new OpenAI({
        apiKey,
        baseURL: baseUrl || "https://api.openai.com/v1",
      });
      const page = await client.models.list();
      const data = Array.isArray(page?.data) ? page.data : [];
      return data
        .map((item) => ({
          id: normalizeText(item?.id),
          ownedBy: normalizeText(item?.owned_by) || undefined,
        }))
        .filter((item) => item.id)
        .sort((a, b) => a.id.localeCompare(b.id));
    }

    if (!baseUrl) {
      throw new Error("Base URL is required when OpenAI SDK is not installed.");
    }

    const response = await fetch(`${baseUrl}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        errorText.trim() || `Fetch models failed with status ${response.status}.`,
      );
    }

    const payload = await response.json().catch(() => null);
    const data = Array.isArray(payload?.data) ? payload.data : [];
    return data
      .map((item) => ({
        id: normalizeText(item?.id),
        ownedBy: normalizeText(item?.owned_by) || undefined,
      }))
      .filter((item) => item.id)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async function resolveSessionForSend(sessionIdInput, messageInput, attachmentsInput) {
    const message = normalizeText(messageInput);
    const attachments = normalizeAttachments(attachmentsInput);
    if (!message && attachments.length === 0) {
      throw new Error("Message cannot be empty.");
    }

    const requestedSessionId = normalizeText(sessionIdInput);
    if (requestedSessionId) {
      const existingSession = await getSettingsStore().getAiChatSessionById(requestedSessionId);
      if (!existingSession) {
        throw new Error(`AI chat session not found: ${requestedSessionId}`);
      }
      return existingSession;
    }

    return getSettingsStore().createAiChatSession({
      title: deriveSessionTitle(message || "Image message"),
    });
  }

  async function maybeUpdateInitialTitle(session, messages, messageInput) {
    if (!session || !Array.isArray(messages) || messages.length > 0) {
      return session;
    }
    if (session.title !== DEFAULT_AI_CHAT_TITLE) {
      return session;
    }
    return getSettingsStore().updateAiChatSessionTitle(
      session.id,
      deriveSessionTitle(messageInput),
    );
  }

  function buildOpenAiUserContentParts(
    textInput,
    attachmentsInput,
    options = {},
  ) {
    const text = String(textInput ?? "").trim();
    const attachments = normalizeAttachments(attachmentsInput);
    const textPartType =
      options.textPartType === "input_text" ? "input_text" : "text";
    const imagePartType =
      options.imagePartType === "input_image" ? "input_image" : "image_url";
    const parts = [];
    if (text) {
      parts.push({ type: textPartType, text });
    }
    attachments.forEach((item) => {
      parts.push(
        imagePartType === "input_image"
          ? { type: "input_image", image_url: item.dataUrl, detail: "auto" }
          : { type: "image_url", image_url: { url: item.dataUrl, detail: "auto" } },
      );
    });
    return parts;
  }

  function buildAnthropicUserContentParts(textInput, attachmentsInput) {
    const text = String(textInput ?? "").trim();
    const attachments = normalizeAttachments(attachmentsInput);
    const parts = attachments.map((item) => {
      const match = item.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      const mediaType = match?.[1] || item.mimeType || "image/png";
      const data = match?.[2] || "";
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: mediaType,
          data,
        },
      };
    });
    if (text) {
      parts.push({
        type: "text",
        text,
      });
    }
    return parts;
  }

  function buildChatCompletionMessages(historyMessages, nextUserMessage, nextAttachments = []) {
    const items = Array.isArray(historyMessages) ? historyMessages : [];
    const normalized = items
      .filter((item) => item && typeof item === "object")
      .filter((item) => {
        const role = normalizeText(item.role);
        return role === "system" || role === "assistant" || role === "user";
      })
      .map((item) => ({
        role: item.role,
        content:
          item.role === "user" && Array.isArray(item.attachments) && item.attachments.length > 0
            ? buildOpenAiUserContentParts(item.content, item.attachments, {
                textPartType: "text",
                imagePartType: "image_url",
              })
            : String(item.content ?? ""),
      }))
      .filter((item) => {
        if (Array.isArray(item.content)) {
          return item.content.length > 0;
        }
        return String(item.content ?? "").trim().length > 0;
      });

    normalized.push({
      role: "user",
      content:
        normalizeAttachments(nextAttachments).length > 0
          ? buildOpenAiUserContentParts(nextUserMessage, nextAttachments, {
              textPartType: "text",
              imagePartType: "image_url",
            })
          : nextUserMessage,
    });
    return normalized;
  }

  function buildResponsesInput(historyMessages, nextUserMessage, nextAttachments = []) {
    const items = Array.isArray(historyMessages) ? historyMessages : [];
    const normalized = items
      .filter((item) => item && typeof item === "object")
      .filter((item) => {
        const role = normalizeText(item.role);
        return role === "system" || role === "assistant" || role === "user";
      })
      .map((item) => ({
        role: item.role,
        content:
          item.role === "user" && Array.isArray(item.attachments) && item.attachments.length > 0
            ? buildOpenAiUserContentParts(item.content, item.attachments, {
                textPartType: "input_text",
                imagePartType: "input_image",
              })
            : String(item.content ?? ""),
      }))
      .filter((item) => {
        if (Array.isArray(item.content)) {
          return item.content.length > 0;
        }
        return item.content.trim().length > 0;
      });

    normalized.push({
      role: "user",
      content:
        normalizeAttachments(nextAttachments).length > 0
          ? buildOpenAiUserContentParts(nextUserMessage, nextAttachments, {
              textPartType: "input_text",
              imagePartType: "input_image",
            })
          : nextUserMessage,
    });
    return normalized;
  }

  function buildResponsesCurrentTurnInput(nextUserMessage, nextAttachments = []) {
    const attachments = normalizeAttachments(nextAttachments);
    if (attachments.length === 0) {
      return nextUserMessage;
    }
    return [
      {
        role: "user",
        content: buildOpenAiUserContentParts(nextUserMessage, attachments, {
          textPartType: "input_text",
          imagePartType: "input_image",
        }),
      },
    ];
  }

  async function handleNonStreamingResponse(response, requestContext) {
    const payload = await response.json().catch(() => null);
    const deltaText =
      requestContext.apiType === "responses"
        ? extractResponsesOutputText(payload)
        : extractDeltaText(payload);
    const nextContent = deltaText || "";
    const responseId =
      requestContext.apiType === "responses"
        ? String(payload?.id ?? "").trim() || null
        : null;
    await getSettingsStore().updateAiChatMessage({
      messageId: requestContext.assistantMessageId,
      content: nextContent,
      responseId,
      status: "complete",
      errorMessage: null,
    });
    if (nextContent) {
      broadcastStreamEvent({
        requestId: requestContext.requestId,
        sessionId: requestContext.sessionId,
        messageId: requestContext.assistantMessageId,
        type: "delta",
        delta: nextContent,
      });
    }
    broadcastStreamEvent({
      requestId: requestContext.requestId,
      sessionId: requestContext.sessionId,
      messageId: requestContext.assistantMessageId,
      type: "done",
    });
  }

  async function handleNonStreamingPayload(payload, requestContext) {
    const deltaText =
      requestContext.provider === "anthropic-sdk"
        ? extractMessageText(payload?.content)
        : requestContext.apiType === "responses"
          ? extractResponsesOutputText(payload)
          : extractDeltaText(payload);
    const nextContent = deltaText || "";
    const responseId =
      requestContext.provider === "openai-sdk" && requestContext.apiType === "responses"
        ? String(payload?.id ?? "").trim() || null
        : null;
    await getSettingsStore().updateAiChatMessage({
      messageId: requestContext.assistantMessageId,
      content: nextContent,
      responseId,
      status: "complete",
      errorMessage: null,
    });
    if (nextContent) {
      broadcastStreamEvent({
        requestId: requestContext.requestId,
        sessionId: requestContext.sessionId,
        messageId: requestContext.assistantMessageId,
        type: "delta",
        delta: nextContent,
      });
    }
    broadcastStreamEvent({
      requestId: requestContext.requestId,
      sessionId: requestContext.sessionId,
      messageId: requestContext.assistantMessageId,
      type: "done",
    });
  }

  async function processSseStream(response, requestContext) {
    const reader = response.body?.getReader?.();
    if (!reader) {
      await handleNonStreamingResponse(response, requestContext);
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let accumulated = "";
    let eventDataLines = [];

    const flushEvent = async () => {
      if (eventDataLines.length === 0) {
        return;
      }
      const data = eventDataLines.join("\n").trim();
      eventDataLines = [];
      if (!data) {
        return;
      }
      if (data === "[DONE]") {
        return;
      }

      let payload = null;
      try {
        payload = JSON.parse(data);
      } catch {
        return;
      }
      const delta =
        requestContext.apiType === "responses"
          ? extractResponsesDeltaText(payload)
          : extractDeltaText(payload);
      if (!delta) {
        return;
      }

      accumulated += delta;
      await getSettingsStore().updateAiChatMessage({
        messageId: requestContext.assistantMessageId,
        content: accumulated,
        status: "streaming",
        errorMessage: null,
      });
      broadcastStreamEvent({
        requestId: requestContext.requestId,
        sessionId: requestContext.sessionId,
        messageId: requestContext.assistantMessageId,
        type: "delta",
        delta,
      });
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (!line) {
          await flushEvent();
          continue;
        }
        if (line.startsWith("data:")) {
          eventDataLines.push(line.slice(5).trimStart());
        }
      }
    }

    buffer += decoder.decode();
    if (buffer) {
      const lines = buffer.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (!line) {
          await flushEvent();
          continue;
        }
        if (line.startsWith("data:")) {
          eventDataLines.push(line.slice(5).trimStart());
        }
      }
    }
    await flushEvent();

    await getSettingsStore().updateAiChatMessage({
      messageId: requestContext.assistantMessageId,
      content: accumulated,
      status: "complete",
      errorMessage: null,
    });
    broadcastStreamEvent({
      requestId: requestContext.requestId,
      sessionId: requestContext.sessionId,
      messageId: requestContext.assistantMessageId,
      type: "done",
    });
  }

  async function runStreamRequest(requestContext, settings, payloadMessages) {
    const controller = new AbortController();
    activeRequests.set(requestContext.requestId, {
      requestId: requestContext.requestId,
      sessionId: requestContext.sessionId,
      messageId: requestContext.assistantMessageId,
      controller,
    });

    try {
      if (settings.provider === "anthropic-sdk") {
        const Anthropic = tryLoadAnthropicSdk();
        if (!Anthropic) {
          throw new Error("Anthropic SDK is not installed. Run pnpm install first.");
        }
        debugLog("anthropic.request", {
          model: settings.model,
          baseUrl: settings.baseUrl || "(default)",
          messageCount: Array.isArray(payloadMessages) ? payloadMessages.length : 0,
          body: sanitizeRequestBody({
            model: settings.model,
            max_tokens: 2048,
            messages: payloadMessages,
            stream: true,
          }),
        }, settings);
        const client = new Anthropic({
          apiKey: settings.apiKey,
          ...(settings.baseUrl ? { baseURL: settings.baseUrl } : {}),
        });
        const stream = await client.messages.create(
          {
            model: settings.model,
            max_tokens: 2048,
            messages: payloadMessages,
            stream: true,
          },
          {
            signal: controller.signal,
          },
        );
        let accumulated = "";
        for await (const event of stream) {
          if (event?.type === "content_block_delta" && event.delta?.type === "text_delta") {
            const delta = String(event.delta.text ?? "");
            if (!delta) {
              continue;
            }
            accumulated += delta;
            await getSettingsStore().updateAiChatMessage({
              messageId: requestContext.assistantMessageId,
              content: accumulated,
              status: "streaming",
              errorMessage: null,
            });
            broadcastStreamEvent({
              requestId: requestContext.requestId,
              sessionId: requestContext.sessionId,
              messageId: requestContext.assistantMessageId,
              type: "delta",
              delta,
            });
          }
        }
        await getSettingsStore().updateAiChatMessage({
          messageId: requestContext.assistantMessageId,
          content: accumulated,
          status: "complete",
          errorMessage: null,
        });
        broadcastStreamEvent({
          requestId: requestContext.requestId,
          sessionId: requestContext.sessionId,
          messageId: requestContext.assistantMessageId,
          type: "done",
        });
        return;
      }

      const OpenAI = tryLoadOpenAiSdk();
      if (OpenAI) {
        const client = new OpenAI({
          apiKey: settings.apiKey,
          baseURL: settings.baseUrl,
        });
        if (settings.apiType === "responses") {
          const responseRequest = {
            model: settings.model,
            input: payloadMessages.input,
            store: payloadMessages.store,
            stream: true,
            ...(payloadMessages.previousResponseId
              ? { previous_response_id: payloadMessages.previousResponseId }
              : {}),
          };
          debugLog("openai.responses.request", {
            model: settings.model,
            baseUrl: settings.baseUrl,
            previousResponseId: requestContext.previousResponseId || null,
            inputType: Array.isArray(payloadMessages.input) ? "messages" : typeof payloadMessages.input,
            body: sanitizeRequestBody(responseRequest),
          }, settings);
          const stream = await client.responses.create(
            responseRequest,
            {
              signal: controller.signal,
            },
          );
          let accumulated = "";
          let finalResponseId = null;
          for await (const event of stream) {
            if (event?.type === "response.output_text.delta") {
              const delta = String(event.delta ?? "");
              if (!delta) {
                continue;
              }
              accumulated += delta;
              await getSettingsStore().updateAiChatMessage({
                messageId: requestContext.assistantMessageId,
                content: accumulated,
                status: "streaming",
                errorMessage: null,
              });
              broadcastStreamEvent({
                requestId: requestContext.requestId,
                sessionId: requestContext.sessionId,
                messageId: requestContext.assistantMessageId,
                type: "delta",
                delta,
              });
            }
            if (event?.type === "response.completed") {
              finalResponseId = String(event.response?.id ?? "").trim() || null;
            }
          }
          await getSettingsStore().updateAiChatMessage({
            messageId: requestContext.assistantMessageId,
            content: accumulated,
            responseId: finalResponseId,
            status: "complete",
            errorMessage: null,
          });
          broadcastStreamEvent({
            requestId: requestContext.requestId,
            sessionId: requestContext.sessionId,
            messageId: requestContext.assistantMessageId,
            type: "done",
          });
          return;
        }

        debugLog("openai.chat.request", {
          model: settings.model,
          baseUrl: settings.baseUrl,
          messageCount: Array.isArray(payloadMessages) ? payloadMessages.length : 0,
          body: sanitizeRequestBody({
            model: settings.model,
            messages: payloadMessages,
            stream: true,
          }),
        }, settings);
        const stream = await client.chat.completions.create({
          model: settings.model,
          messages: payloadMessages,
          stream: true,
          signal: controller.signal,
        });
        let accumulated = "";
        for await (const chunk of stream) {
          const delta = String(chunk?.choices?.[0]?.delta?.content ?? "");
          if (!delta) {
            continue;
          }
          accumulated += delta;
          await getSettingsStore().updateAiChatMessage({
            messageId: requestContext.assistantMessageId,
            content: accumulated,
            status: "streaming",
            errorMessage: null,
          });
          broadcastStreamEvent({
            requestId: requestContext.requestId,
            sessionId: requestContext.sessionId,
            messageId: requestContext.assistantMessageId,
            type: "delta",
            delta,
          });
        }
        await getSettingsStore().updateAiChatMessage({
          messageId: requestContext.assistantMessageId,
          content: accumulated,
          status: "complete",
          errorMessage: null,
        });
        broadcastStreamEvent({
          requestId: requestContext.requestId,
          sessionId: requestContext.sessionId,
          messageId: requestContext.assistantMessageId,
          type: "done",
        });
        return;
      }

      const endpoint =
        settings.apiType === "responses" ? `${settings.baseUrl}/responses` : `${settings.baseUrl}/chat/completions`;
      const requestBody =
        settings.apiType === "responses"
          ? {
              model: settings.model,
              input: payloadMessages.input,
              store: payloadMessages.store,
              stream: true,
              ...(payloadMessages.previousResponseId
                ? { previous_response_id: payloadMessages.previousResponseId }
                : {}),
            }
          : {
              model: settings.model,
              messages: payloadMessages,
              stream: true,
            };

      debugLog("fetch.request", {
        provider: settings.provider,
        apiType: settings.apiType,
        endpoint,
        body: sanitizeRequestBody(requestBody),
      }, settings);

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        debugLog("fetch.error", {
          endpoint,
          status: response.status,
          body: truncateText(errorText, 2000),
        }, settings);
        throw new Error(
          errorText.trim() || `AI request failed with status ${response.status}.`,
        );
      }

      const contentType = String(response.headers.get("content-type") ?? "").toLowerCase();
      if (!contentType.includes("text/event-stream")) {
        await handleNonStreamingResponse(response, requestContext);
        return;
      }

      await processSseStream(response, requestContext);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      debugLog("request.error", {
        requestId: requestContext.requestId,
        provider: requestContext.provider,
        apiType: requestContext.apiType,
        details: expandErrorDetails(error),
      }, requestContext);
      const wasCanceled =
        error instanceof Error &&
        (error.name === "AbortError" || /aborted|abort/i.test(error.message));
      const currentMessage =
        await getSettingsStore().getAiChatMessageById(requestContext.assistantMessageId);
      await getSettingsStore().updateAiChatMessage({
        messageId: requestContext.assistantMessageId,
        content: currentMessage?.content ?? "",
        status: "error",
        errorMessage: wasCanceled ? "Canceled by user." : message,
      });
      broadcastStreamEvent({
        requestId: requestContext.requestId,
        sessionId: requestContext.sessionId,
        messageId: requestContext.assistantMessageId,
        type: wasCanceled ? "canceled" : "error",
        error: wasCanceled ? "Canceled by user." : message,
      });
    } finally {
      activeRequests.delete(requestContext.requestId);
    }
  }

  async function sendMessage(input) {
    if (activeRequests.size > 0 || pendingRequests.size > 0) {
      throw new Error("Another AI response is currently generating.");
    }

    const message = normalizeText(input?.message);
    const attachments = normalizeAttachmentsInput(input);
    debugLog("send.input", {
      provider: input?.provider,
      messageLength: message.length,
      attachmentsCount: attachments.length,
      attachments: attachments.map((item) => ({
        id: item.id,
        mimeType: item.mimeType,
        dataUrlPrefix: item.dataUrl.slice(0, 48),
      })),
    }, input);
    if (!message && attachments.length === 0) {
      throw new Error("Message cannot be empty.");
    }

    const settings = await ensureConfigured();
    let session = await resolveSessionForSend(input?.sessionId, message, attachments);
    const existingMessages = await getSettingsStore().listAiChatSessionMessages(session.id);
    session =
      (await maybeUpdateInitialTitle(session, existingMessages, message || "Image message")) || session;

    const userMessage = await getSettingsStore().createAiChatMessage({
      sessionId: session.id,
      role: "user",
      content: message,
      attachments,
      status: "complete",
    });
    const assistantMessage = await getSettingsStore().createAiChatMessage({
      sessionId: session.id,
      role: "assistant",
      content: "",
      attachments: [],
      status: "streaming",
      errorMessage: null,
    });

    const requestId = createId();
    const requestContext = {
      requestId,
      sessionId: session.id,
      assistantMessageId: assistantMessage.id,
      provider: settings.provider,
      apiType: settings.apiType,
      debugEnabled: settings.debugEnabled === true,
      previousResponseId: null,
    };

    let payloadMessages = null;
    if (settings.provider === "anthropic-sdk") {
      payloadMessages = existingMessages
        .filter((item) => item && typeof item === "object")
        .filter((item) => {
          const role = normalizeText(item.role);
          return role === "assistant" || role === "user";
        })
        .map((item) => ({
          role: item.role,
          content:
            item.role === "user" && Array.isArray(item.attachments) && item.attachments.length > 0
              ? buildAnthropicUserContentParts(item.content, item.attachments)
              : String(item.content ?? ""),
        }))
        .concat([
          {
            role: "user",
            content:
              attachments.length > 0
                ? buildAnthropicUserContentParts(message, attachments)
                : message,
          },
        ]);
    } else if (settings.apiType === "responses") {
      const previousResponseId =
        await getSettingsStore().getLatestAiChatResponseId(session.id);
      requestContext.previousResponseId = previousResponseId;
      payloadMessages = {
        input: previousResponseId
          ? buildResponsesCurrentTurnInput(message, attachments)
          : buildResponsesInput(existingMessages, message, attachments),
        previousResponseId,
        store: true,
      };
    } else {
      payloadMessages = buildChatCompletionMessages(existingMessages, message, attachments);
    }
    const expireTimer = setTimeout(async () => {
      const pending = pendingRequests.get(requestId);
      if (!pending) {
        return;
      }
      pendingRequests.delete(requestId);
      await getSettingsStore().updateAiChatMessage({
        messageId: pending.requestContext.assistantMessageId,
        status: "error",
        errorMessage: "Request start timed out.",
      });
      broadcastStreamEvent({
        requestId: pending.requestContext.requestId,
        sessionId: pending.requestContext.sessionId,
        messageId: pending.requestContext.assistantMessageId,
        type: "error",
        error: "Request start timed out.",
      });
    }, PENDING_REQUEST_TTL_MS);
    pendingRequests.set(requestId, {
      expireTimer,
      payloadMessages,
      requestContext,
      settings,
    });

    return {
      requestId,
      session: (await getSettingsStore().getAiChatSessionById(session.id)) || session,
      userMessage,
      assistantMessage,
    };
  }

  async function beginStream(requestIdInput) {
    const requestId = normalizeText(requestIdInput);
    if (!requestId) {
      throw new Error("Request id is required.");
    }
    const pending = pendingRequests.get(requestId);
    if (!pending) {
      if (activeRequests.has(requestId)) {
        return true;
      }
      throw new Error(`AI chat request not found: ${requestId}`);
    }
    pendingRequests.delete(requestId);
    clearTimeout(pending.expireTimer);

    broadcastStreamEvent({
      requestId: pending.requestContext.requestId,
      sessionId: pending.requestContext.sessionId,
      messageId: pending.requestContext.assistantMessageId,
      type: "start",
    });

    void runStreamRequest(
      pending.requestContext,
      pending.settings,
      pending.payloadMessages,
    );
    return true;
  }

  async function cancelStream(requestIdInput) {
    const requestId = normalizeText(requestIdInput);
    if (!requestId) {
      return false;
    }
    if (pendingRequests.has(requestId)) {
      const pending = pendingRequests.get(requestId);
      pendingRequests.delete(requestId);
      if (pending) {
        clearTimeout(pending.expireTimer);
        await getSettingsStore().updateAiChatMessage({
          messageId: pending.requestContext.assistantMessageId,
          status: "error",
          errorMessage: "Canceled by user.",
        });
        broadcastStreamEvent({
          requestId: pending.requestContext.requestId,
          sessionId: pending.requestContext.sessionId,
          messageId: pending.requestContext.assistantMessageId,
          type: "canceled",
          error: "Canceled by user.",
        });
      }
      return true;
    }
    const active = activeRequests.get(requestId);
    if (!active) {
      return false;
    }
    active.controller.abort();
    return true;
  }

  return {
    listModels,
    beginStream,
    cancelStream,
    getActiveRequestCount: () => activeRequests.size,
    sendMessage,
    streamChannel: AI_CHAT_STREAM_CHANNEL,
    subscribe,
    unsubscribe,
  };
}

module.exports = {
  createAiChatManager,
};
