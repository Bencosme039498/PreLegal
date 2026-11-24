// AI chat that picks a document and fills in its fields. All LLM calls happen in the
// backend (POST /api/chat); this module is the client, its error handling, the per-tab storage and
// the handoff that carries a conversation to the document page the AI chose.
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
  /**
   * The document the conversation is now about: null while the AI is still finding out what the
   * user needs. When it differs from the template the request was about (the AI chose a document,
   * or switched to another), the client opens that document's page.
   */
  template_id: string | null;
  /** Every field of template_id with a valid value (raw text; fillTemplate escapes it). */
  values: FieldValues;
  complete: boolean;
}

/** What the chat shows when a turn fails (same shape as the backend's coded error). */
export type ChatFailure = ErrorEnvelope;

// Mirrors MAX_MESSAGE_CHARS in backend/app/schemas.py.
export const MAX_MESSAGE_CHARS = 2000;
/** Only the latest turns are sent (mirrors MAX_HISTORY in backend/app/chat.py): the values carry the document state. */
export const MAX_SENT_MESSAGES = 30;
/** Above the backend's per-request budget (chat_budget_s, 50 s), so its answer or error arrives first. */
const CHAT_TIMEOUT_MS = 60_000;

/** The assistant's opening message: for a given document, or (home page) to find the right one. */
export function greeting(documentName?: string): string {
  if (!documentName) {
    return (
      "Hi! What do you need to draft? Describe the document or your situation and I'll find the right " +
      "template. If it's something we can't generate, I'll suggest the closest option."
    );
  }
  return (
    `Hi! I'll help you draft a ${documentName}. Tell me about the people or companies involved and the ` +
    "main terms. Any order is fine, and I'll ask about anything that's missing."
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

/**
 * Sends the conversation (ending with the user's message) and the current values; returns the AI's
 * turn. Without a template (home page) the AI works out which document the user needs.
 */
export function sendChat(
  templateId: string | null,
  messages: ChatMessage[],
  values: FieldValues,
  init?: ApiRequestInit,
): Promise<ChatTurnResult> {
  return apiRequest<ChatTurnResult>("/api/chat", {
    timeoutMs: CHAT_TIMEOUT_MS,
    ...init,
    method: "POST",
    body: JSON.stringify({
      ...(templateId ? { template_id: templateId } : {}),
      messages: messages.slice(-MAX_SENT_MESSAGES),
      values,
    }),
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
  /** The conversation started on the home page (it keeps the home greeting). */
  fromHome?: boolean;
  /** The saved document this draft autosaves to (signed-in users), once it has been created. */
  docId?: number;
}

/** Storage target of the home page chat (template ids are kebab-case, so this can't clash). */
export const HOME_CHAT = "_home";

/** Scoped by user, so another account signed in later in the same tab doesn't see this conversation. */
export const chatStorageKey = (userEmail: string, target: string) => `prelegal.chat.v1:${userEmail}:${target}`;

export const templatePath = (templateId: string) => `/templates/${templateId}/`;

/** Parses a stored chat, keeping only well-formed messages and values for known fields. */
export function parseStoredChat(raw: string | null, fieldKeys: readonly string[]): StoredChat | null {
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    const { messages, values, fromHome, docId } = data as Record<string, unknown>;
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
      fromHome: fromHome === true,
      ...(typeof docId === "number" && Number.isSafeInteger(docId) && docId > 0 ? { docId } : {}),
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

/** Forgets every conversation of this user in this tab (on sign-out). */
export function clearChats(userEmail: string): void {
  try {
    const prefix = chatStorageKey(userEmail, "");
    const storage = window.sessionStorage;
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
    for (const key of keys) if (key?.startsWith(prefix)) storage.removeItem(key);
  } catch {
    // Nothing stored.
  }
}

// ---- Handoff: the AI chose (or switched to) a document, so its page continues the conversation ----

export interface Handoff {
  /** Where the conversation is saved for the document page to pick up. */
  key: string;
  chat: StoredChat;
  href: string;
}

/**
 * Plans opening `templateId`'s page with the conversation so far (including the AI's reply) and
 * the values it already holds for that document. Overwrites any older chat for that document.
 */
export function planHandoff(
  userEmail: string,
  templateId: string,
  conversation: ChatMessage[],
  values: FieldValues,
  fromHome = false,
): Handoff {
  return {
    key: chatStorageKey(userEmail, templateId),
    chat: { messages: conversation, values, fromHome },
    href: templatePath(templateId),
  };
}
