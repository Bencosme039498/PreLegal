// Fake sign-in (PL-6): no password or authentication, it only identifies who is using the app.
// The user is remembered in localStorage; the backend records them in its temporary database
// when it is reachable. Real authentication arrives in PL-9.
import { ApiUnavailableError, apiRequest, type ApiRequestInit } from "./api-client";

export interface SessionUser {
  /** Backend user id, or null when signed in without a backend (static hosting). */
  id: number | null;
  name: string;
  email: string;
  /** Whether the backend recorded the user. */
  persisted: boolean;
}

export interface LoginInput {
  name: string;
  email: string;
}

export type LoginErrors = Partial<Record<keyof LoginInput, string>>;

export const STORAGE_KEY = "prelegal.session.v1";
/** Same-tab change notification (the `storage` event only fires in other tabs). */
export const SESSION_EVENT = "prelegal:session";

// Mirrors the backend's SessionRequest constraints (backend/app/schemas.py).
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const NAME_MAX = 100;
const EMAIL_MAX = 254;

/** Trims and lower-cases the input, or returns per-field errors. */
export function validateLogin(input: LoginInput): { ok: true; value: LoginInput } | { ok: false; errors: LoginErrors } {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const errors: LoginErrors = {};
  if (!name) errors.name = "Enter your name.";
  else if (name.length > NAME_MAX) errors.name = `Use at most ${NAME_MAX} characters.`;
  if (!EMAIL_PATTERN.test(email) || email.length > EMAIL_MAX) errors.email = "Enter a valid email address.";
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: { name, email } };
}

/** Parses a stored session, or null if it is missing or malformed. */
export function parseUser(raw: string | null): SessionUser | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const { id, name, email, persisted } = value as Record<string, unknown>;
    if (typeof name !== "string" || !name || typeof email !== "string" || !email) return null;
    return {
      id: typeof id === "number" ? id : null,
      name,
      email,
      persisted: persisted === true,
    };
  } catch {
    return null;
  }
}

/**
 * Records the user in the backend; if no backend answers (static hosting), signs in on this
 * device only. Validation errors from the backend (ApiError) are rethrown.
 */
export async function loginUser(input: LoginInput, init?: ApiRequestInit): Promise<SessionUser> {
  try {
    const user = await apiRequest<{ id: number; name: string; email: string }>("/api/session", {
      ...init,
      method: "POST",
      body: JSON.stringify(input),
    });
    return { id: user.id, name: user.name, email: user.email, persisted: true };
  } catch (error) {
    if (error instanceof ApiUnavailableError) return { id: null, ...input, persisted: false };
    throw error;
  }
}

// ---- Browser storage (safe when localStorage is blocked, e.g. some private modes) ----

/** The raw stored session string: a stable primitive snapshot for useSyncExternalStore. */
export function readStoredSession(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function notify() {
  window.dispatchEvent(new Event(SESSION_EVENT));
}

export function saveSession(user: SessionUser): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  } finally {
    notify();
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } finally {
    notify();
  }
}

export function subscribeSession(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(SESSION_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(SESSION_EVENT, onChange);
  };
}
