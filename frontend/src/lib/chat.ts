// AI chat that fills in a template's fields (PL-7: Mutual NDA only). All LLM calls happen in the
// backend (POST /api/chat); this module is the client, its error handling and the per-tab storage.
import {
  ApiError,
  ApiUnavailableError,
  apiRequest,
  isErrorEnvelope,
  type ApiRequestInit,
  type ErrorEnvelope,
} from "./api-client";
import type { FieldValues } from "./fill-template";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatTurnResult {
  reply: string;
  /** Every field with a valid value after this turn (raw text; fillTemplate escapes it). */
  values: FieldValues;
  complete: boolean;
}

/** What the chat shows when a turn fails (same shape as the backend's coded error). */
export type ChatFailure = ErrorEnvelope;

/** Templates the assistant supports. PL-8 opens it to every template. */
export const CHAT_TEMPLATE_IDS: readonly string[] = ["mutual-nda"];

export const supportsChat = (templateId: string) => CHAT_TEMPLATE_IDS.includes(templateId);

// Mirrors MAX_MESSAGE_CHARS in backend/app/schemas.py.
export const MAX_MESSAGE_CHARS = 2000;
/** Only the latest turns are sent (mirrors MAX_HISTORY in backend/app/chat.py): the values carry the document state. */
const MAX_SENT_MESSAGES = 30;
/** Above the backend's worst case (2 attempts x 20 s plus backoff), so its error arrives first. */
const CHAT_TIMEOUT_MS = 60_000;

export function greeting(documentName: string): string {
  return (
    `Hi! I'll help you draft a ${documentName}. Tell me about the two companies involved and what ` +
    "information you'll be sharing. Any order is fine, and I'll ask about anything that's missing."
  );
}

/** Whether a PreLegal backend answers here (false on a static-only host such as Vercel). */
export async function isChatAvailable(init?: ApiRequestInit): Promise<boolean> {
  try {
    await apiRequest("/api/health", init);
    return true;
  } catch {
    return false;
  }
}

/** Sends the conversation (ending with the user's message) and the current values; returns the AI's turn. */
export function sendChat(
  templateId: string,
  messages: ChatMessage[],
  values: FieldValues,
  init?: ApiRequestInit,
): Promise<ChatTurnResult> {
  return apiRequest<ChatTurnResult>("/api/chat", {
    timeoutMs: CHAT_TIMEOUT_MS,
    ...init,
    method: "POST",
    body: JSON.stringify({ template_id: templateId, messages: messages.slice(-MAX_SENT_MESSAGES), values }),
  });
}

/** What to tell the user when a chat request fails. */
export function chatFailure(error: unknown): ChatFailure {
  if (error instanceof ApiError && isErrorEnvelope(error.detail)) return error.detail;
  if (error instanceof ApiError) {
    return {
      code: "invalid_request",
      message: "That message couldn't be sent. Try a shorter message, or start over.",
      retryable: false,
    };
  }
  if (error instanceof ApiUnavailableError) {
    return {
      code: "network",
      message: "Couldn't reach the assistant. Check your connection and try again.",
      retryable: true,
    };
  }
  return { code: "unknown", message: "Something went wrong. Try again.", retryable: true };
}

// ---- Per-tab persistence (sessionStorage): survives a reload, cleared when the tab closes ----

export interface StoredChat {
  messages: ChatMessage[];
  values: FieldValues;
}

/** Scoped by user, so a different (fake) sign-in in the same tab doesn't see this conversation. */
export const chatStorageKey = (userEmail: string, templateId: string) =>
  `prelegal.chat.v1:${userEmail}:${templateId}`;

/** Parses a stored chat, keeping only well-formed messages and values for known fields. */
export function parseStoredChat(raw: string | null, fieldKeys: readonly string[]): StoredChat | null {
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    const { messages, values } = data as Record<string, unknown>;
    if (!Array.isArray(messages) || !values || typeof values !== "object") return null;
    const known = new Set(fieldKeys);
    return {
      messages: messages.filter(
        (m): m is ChatMessage =>
          !!m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
      ),
      values: Object.fromEntries(
        Object.entries(values).filter(([k, v]) => known.has(k) && typeof v === "string"),
      ) as FieldValues,
    };
  } catch {
    return null;
  }
}

export function loadChat(key: string, fieldKeys: readonly string[]): StoredChat | null {
  try {
    return parseStoredChat(window.sessionStorage.getItem(key), fieldKeys);
  } catch {
    return null;
  }
}

export function saveChat(key: string, chat: StoredChat): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(chat));
  } catch {
    // Storage blocked or full: the chat still works, it just won't survive a reload.
  }
}

export function clearChat(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Nothing stored.
  }
}
