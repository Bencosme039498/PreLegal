// Accounts (PL-9). The backend keeps the session in an HttpOnly cookie, which JavaScript never sees;
// localStorage only caches who is signed in, so pages can render at once. RequireSession checks the
// cookie with GET /api/auth/me, and any 401 not_authenticated clears the cache (see api-client.ts).
//
// Without a backend (static hosting such as Vercel, or `next dev`) there are no accounts: a labelled
// demo sign-in keeps a name and email on this device only, and nothing is saved.
import { ApiError, apiRequest, isErrorEnvelope, type ApiRequestInit } from "./api-client";
import { clearChats } from "./chat";

export interface SessionUser {
  /** Backend user id, or null in demo mode (no backend). */
  id: number | null;
  name: string;
  email: string;
  /** Signed in to a real account (false: demo mode, on this device only). */
  persisted: boolean;
}

export interface SignUpInput {
  name: string;
  email: string;
  password: string;
}

export type SignInInput = Omit<SignUpInput, "name">;
export type DemoInput = Omit<SignUpInput, "password">;

export type FieldErrors<T> = Partial<Record<keyof T, string>>;
export type Validation<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors<T> };

export const STORAGE_KEY = "prelegal.session.v1";
/** Same-tab change notification (the `storage` event only fires in other tabs). */
export const SESSION_EVENT = "prelegal:session";

// Mirror the backend's SignUpRequest / SignInRequest (backend/app/schemas.py).
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const NAME_MAX = 100;
const EMAIL_MAX = 254;
export const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

const cleanName = (name: string) => name.trim();
const cleanEmail = (email: string) => email.trim().toLowerCase();

function nameError(name: string): string | undefined {
  if (!name) return "Enter your name.";
  if (name.length > NAME_MAX) return `Use at most ${NAME_MAX} characters.`;
}

function emailError(email: string): string | undefined {
  if (!EMAIL_PATTERN.test(email) || email.length > EMAIL_MAX) return "Enter a valid email address.";
}

function result<T>(value: T, errors: FieldErrors<T>): Validation<T> {
  return Object.values(errors).some(Boolean) ? { ok: false, errors } : { ok: true, value };
}

/** Trims the name, trims and lower-cases the email, and checks the password length. */
export function validateSignUp(input: SignUpInput): Validation<SignUpInput> {
  const value = { name: cleanName(input.name), email: cleanEmail(input.email), password: input.password };
  const password =
    value.password.length < PASSWORD_MIN
      ? `Use at least ${PASSWORD_MIN} characters.`
      : value.password.length > PASSWORD_MAX
        ? `Use at most ${PASSWORD_MAX} characters.`
        : undefined;
  return result(value, { name: nameError(value.name), email: emailError(value.email), password });
}

export function validateSignIn(input: SignInInput): Validation<SignInInput> {
  const value = { email: cleanEmail(input.email), password: input.password };
  const password = !value.password
    ? "Enter your password."
    : value.password.length > PASSWORD_MAX
      ? `Use at most ${PASSWORD_MAX} characters.`
      : undefined;
  return result(value, { email: emailError(value.email), password });
}

export function validateDemo(input: DemoInput): Validation<DemoInput> {
  const value = { name: cleanName(input.name), email: cleanEmail(input.email) };
  return result(value, { name: nameError(value.name), email: emailError(value.email) });
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

// ---- Backend calls (errors: ApiError with a coded envelope, or ApiUnavailableError) ----

interface UserOut {
  id: number;
  name: string;
  email: string;
}

const accountUser = (user: UserOut): SessionUser => ({ ...user, persisted: true });

/** Creates an account and signs in. ApiError 409 `email_taken` if the email is registered. */
export async function signUp(input: SignUpInput, init?: ApiRequestInit): Promise<SessionUser> {
  return accountUser(
    await apiRequest<UserOut>("/api/auth/signup", { ...init, method: "POST", body: JSON.stringify(input) }),
  );
}

/** Signs in. ApiError 401 `invalid_credentials` for a wrong email or password. */
export async function signIn(input: SignInInput, init?: ApiRequestInit): Promise<SessionUser> {
  return accountUser(
    await apiRequest<UserOut>("/api/auth/login", { ...init, method: "POST", body: JSON.stringify(input) }),
  );
}

/** The user the session cookie belongs to, or null if it has expired (or was never set). */
export async function fetchCurrentUser(init?: ApiRequestInit): Promise<SessionUser | null> {
  try {
    return accountUser(await apiRequest<UserOut>("/api/auth/me", init));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

/** Ends the session on the backend (best effort) and forgets the user on this device. */
export async function signOut(user: SessionUser, init?: ApiRequestInit): Promise<void> {
  try {
    await apiRequest<void>("/api/auth/logout", { ...init, method: "POST" });
  } catch {
    // Signed out locally anyway; the cookie expires on its own.
  } finally {
    forgetUser(user);
  }
}

/** Forgets the user in this tab: the cached account and their conversations (sessionStorage). */
export function forgetUser(user: SessionUser | null): void {
  if (user) clearChats(user.email);
  clearSession();
}

/** Demo mode (no backend): a name and email kept on this device only. */
export function demoUser(input: DemoInput): SessionUser {
  return { id: null, ...input, persisted: false };
}

/** What the sign-in and sign-up forms show for a rejected request. */
export function authErrorMessage(error: unknown): string {
  if (error instanceof ApiError && isErrorEnvelope(error.detail)) return error.detail.message;
  if (error instanceof ApiError) return "Those details were not accepted. Check them and try again.";
  return "Couldn't reach PreLegal. Check your connection and try again.";
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
