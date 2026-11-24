import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, ApiUnavailableError } from "./api-client";
import {
  SESSION_EVENT,
  STORAGE_KEY,
  authErrorMessage,
  clearSession,
  demoUser,
  fetchCurrentUser,
  parseUser,
  readStoredSession,
  saveSession,
  signIn,
  signOut,
  signUp,
  subscribeSession,
  validateDemo,
  validateSignIn,
  validateSignUp,
  type SessionUser,
} from "./session";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const envelope = (code: string, message = "Readable message.") => ({ detail: { code, message, retryable: false } });

const errorKeys = (result: { ok: boolean; errors?: object }) =>
  result.ok ? [] : Object.entries(result.errors ?? {}).filter(([, v]) => v).map(([k]) => k).sort();

describe("validateSignUp", () => {
  const valid = { name: "Jane Smith", email: "jane@example.com", password: "long enough" };

  it("trims the name, trims + lower-cases the email and keeps the password as typed", () => {
    expect(validateSignUp({ name: "  Jane Smith ", email: " Jane@Example.COM ", password: " spaced pw " })).toEqual({
      ok: true,
      value: { name: "Jane Smith", email: "jane@example.com", password: " spaced pw " },
    });
  });

  it.each([
    [{ name: "" }, ["name"]],
    [{ name: "   " }, ["name"]],
    [{ name: "x".repeat(101) }, ["name"]],
    [{ email: "jane" }, ["email"]],
    [{ email: "jane@example" }, ["email"]],
    [{ email: "ja ne@example.com" }, ["email"]],
    [{ password: "short" }, ["password"]],
    [{ password: "x".repeat(129) }, ["password"]],
    [{ name: "", email: "", password: "" }, ["email", "name", "password"]],
  ])("rejects %j", (overrides, fields) => {
    expect(errorKeys(validateSignUp({ ...valid, ...overrides }))).toEqual(fields);
  });
});

describe("validateSignIn and validateDemo", () => {
  it("accepts any non-empty password when signing in (the backend checks it)", () => {
    expect(validateSignIn({ email: " JANE@example.com", password: "x" })).toEqual({
      ok: true,
      value: { email: "jane@example.com", password: "x" },
    });
    expect(errorKeys(validateSignIn({ email: "nope", password: "" }))).toEqual(["email", "password"]);
  });

  it("needs a name and an email in demo mode", () => {
    expect(validateDemo({ name: " Jane ", email: "Jane@Example.com" })).toEqual({
      ok: true,
      value: { name: "Jane", email: "jane@example.com" },
    });
    expect(errorKeys(validateDemo({ name: "", email: "x" }))).toEqual(["email", "name"]);
  });
});

describe("parseUser", () => {
  const user: SessionUser = { id: 3, name: "Jane", email: "jane@example.com", persisted: true };

  it("round-trips a stored user", () => {
    expect(parseUser(JSON.stringify(user))).toEqual(user);
  });

  it("defaults id and persisted for a device-only session", () => {
    expect(parseUser(JSON.stringify({ name: "Jane", email: "jane@example.com" }))).toEqual({
      id: null,
      name: "Jane",
      email: "jane@example.com",
      persisted: false,
    });
  });

  it.each([null, "", "not json", "null", "42", '"jane"', '{"name":"Jane"}', '{"name":"","email":"a@b.co"}', '{"name":1,"email":"a@b.co"}'])(
    "returns null for %j",
    (raw) => {
      expect(parseUser(raw)).toBeNull();
    },
  );
});

describe("account requests", () => {
  const user = { id: 7, name: "Jane", email: "jane@example.com" };

  it("signs up and returns the account user", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json(201, user));
    const input = { ...user, password: "long enough" };
    await expect(signUp(input, { fetchImpl })).resolves.toEqual({ ...user, persisted: true });
    const [path, init] = fetchImpl.mock.calls[0];
    expect(path).toBe("/api/auth/signup");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual(input);
  });

  it("signs in", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json(200, user));
    await expect(signIn({ email: user.email, password: "pw" }, { fetchImpl })).resolves.toEqual({
      ...user,
      persisted: true,
    });
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/auth/login");
  });

  it("rethrows rejected sign-ins and unreachable backends", async () => {
    const rejected = vi.fn<typeof fetch>().mockResolvedValue(json(401, envelope("invalid_credentials")));
    await expect(signIn({ email: user.email, password: "pw" }, { fetchImpl: rejected })).rejects.toBeInstanceOf(
      ApiError,
    );
    const offline = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(signIn({ email: user.email, password: "pw" }, { fetchImpl: offline })).rejects.toBeInstanceOf(
      ApiUnavailableError,
    );
  });

  it("fetches the current user, or null when the session has ended", async () => {
    const ok = vi.fn<typeof fetch>().mockResolvedValue(json(200, user));
    await expect(fetchCurrentUser({ fetchImpl: ok })).resolves.toEqual({ ...user, persisted: true });
    expect(ok.mock.calls[0][0]).toBe("/api/auth/me");
    const ended = vi.fn<typeof fetch>().mockResolvedValue(json(401, envelope("not_authenticated")));
    await expect(fetchCurrentUser({ fetchImpl: ended })).resolves.toBeNull();
    const down = vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>", { status: 502 }));
    await expect(fetchCurrentUser({ fetchImpl: down })).rejects.toBeInstanceOf(ApiUnavailableError);
  });

  it("makes a demo user that isn't an account", () => {
    expect(demoUser({ name: "Jane", email: "jane@example.com" })).toEqual({
      id: null,
      name: "Jane",
      email: "jane@example.com",
      persisted: false,
    });
  });

  it("explains failures with the backend's message when there is one", () => {
    expect(authErrorMessage(new ApiError(409, envelope("email_taken", "Already registered.").detail))).toBe(
      "Already registered.",
    );
    expect(authErrorMessage(new ApiError(422, []))).toMatch(/not accepted/);
    expect(authErrorMessage(new ApiUnavailableError())).toMatch(/Couldn't reach PreLegal/);
  });
});

describe("session storage", () => {
  const user: SessionUser = { id: 1, name: "Jane", email: "jane@example.com", persisted: true };
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    const localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    vi.stubGlobal("window", Object.assign(new EventTarget(), { localStorage }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("saves, reads and clears the session, notifying subscribers each time", () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeSession(onChange);

    saveSession(user);
    expect(parseUser(readStoredSession())).toEqual(user);
    expect(store.has(STORAGE_KEY)).toBe(true);

    clearSession();
    expect(readStoredSession()).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(2);

    unsubscribe();
    window.dispatchEvent(new Event(SESSION_EVENT));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("reacts to storage events from other tabs for the session key only", () => {
    const onChange = vi.fn();
    subscribeSession(onChange);
    const storageEvent = (key: string | null) => Object.assign(new Event("storage"), { key });
    window.dispatchEvent(storageEvent("other-key"));
    window.dispatchEvent(storageEvent(STORAGE_KEY));
    window.dispatchEvent(storageEvent(null)); // localStorage.clear()
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("reads null when storage is blocked", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new DOMException("blocked", "SecurityError");
        },
      },
    });
    expect(readStoredSession()).toBeNull();
  });
});

describe("signOut", () => {
  beforeEach(() => {
    const store = new Map([[STORAGE_KEY, "{}"]]);
    const localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    vi.stubGlobal("window", Object.assign(new EventTarget(), { localStorage }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("ends the backend session and forgets the user", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    await signOut({ id: 1, name: "Jane", email: "jane@example.com", persisted: true }, { fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/auth/logout");
    expect(readStoredSession()).toBeNull();
  });

  it("forgets the user even when the backend can't be reached", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline"));
    await signOut({ id: 1, name: "Jane", email: "jane@example.com", persisted: true }, { fetchImpl });
    expect(readStoredSession()).toBeNull();
  });
});
