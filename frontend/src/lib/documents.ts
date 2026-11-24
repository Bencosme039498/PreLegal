// A signed-in user's saved documents (drafts): the client for /api/documents and small pure helpers.
import { apiRequest, type ApiRequestInit } from "./api-client";
import type { ChatMessage } from "./chat";
import type { FieldValues } from "./fill-template";

export interface DocumentSummary {
  id: number;
  template_id: string;
  title: string;
  /** Every required field has a valid value (computed by the backend). */
  complete: boolean;
  created_at: string;
  updated_at: string;
}

export interface SavedDocument extends DocumentSummary {
  values: FieldValues;
  messages: ChatMessage[];
}

/** What a save sends: the whole draft (every save replaces all of it). */
export interface DocumentContent {
  title: string;
  values: FieldValues;
  messages: ChatMessage[];
}

const json = (body: unknown) => JSON.stringify(body);

export const listDocuments = (init?: ApiRequestInit) => apiRequest<DocumentSummary[]>("/api/documents", init);

export const getDocument = (id: number, init?: ApiRequestInit) =>
  apiRequest<SavedDocument>(`/api/documents/${id}`, init);

export const createDocument = (templateId: string, content: DocumentContent, init?: ApiRequestInit) =>
  apiRequest<SavedDocument>("/api/documents", {
    ...init,
    method: "POST",
    body: json({ template_id: templateId, ...content }),
  });

export const updateDocument = (id: number, content: DocumentContent, init?: ApiRequestInit) =>
  apiRequest<SavedDocument>(`/api/documents/${id}`, { ...init, method: "PUT", body: json(content) });

export const deleteDocument = (id: number, init?: ApiRequestInit) =>
  apiRequest<void>(`/api/documents/${id}`, { ...init, method: "DELETE" });

/** The page that edits a saved document (a query parameter: the site is a static export). */
export const documentHref = (templateId: string, id: number) => `/templates/${templateId}/?doc=${id}`;

/** The `?doc=` id in a query string, or null if there is none (or it isn't a positive integer). */
export function parseDocId(search: string): number | null {
  const raw = new URLSearchParams(search).get("doc");
  if (!raw || !/^[1-9][0-9]{0,15}$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

/** A draft's title in the documents list: its parties (e.g. "Acme Inc & Globex LLC"), or "" when none
 * are known yet (the backend then uses the template's name). */
export function documentTitle(partyNames: (string | undefined)[]): string {
  return partyNames
    .map((n) => n?.trim().replace(/\s+/g, " ") ?? "")
    .filter(Boolean)
    .join(" & ")
    .slice(0, 200);
}

/** e.g. "24 Nov 2026, 14:05" in the user's locale and time zone. */
export function formatUpdatedAt(iso: string, locale?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}
