import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api-client";
import {
  SESSION_EVENT,
  STORAGE_KEY,
  clearSession,
  loginUser,
  parseUser,
  readStoredSession,
  saveSession,
  subscribeSession,
  validateLogin,
  type SessionUser,
} from "./session";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("validateLogin", () => {
  it("trims the name and trims + lower-cases the email", () => {
    expect(validateLogin({ name: "  Jane Smith ", email: " Jane@Example.COM " })).toEqual({
      ok: true,
      value: { name: "Jane Smith", email: "jane@example.com" },
    });
  });

  it.each([
    [{ name: "", email: "jane@example.com" }, ["name"]],
    [{ name: "   ", email: "jane@example.com" }, ["name"]],
    [{ name: "x".repeat(101), email: "jane@example.com" }, ["name"]],
    [{ name: "Jane", email: "jane" }, ["email"]],
    [{ name: "Jane", email: "jane@example" }, ["email"]],
    [{ name: "Jane", email: "ja ne@example.com" }, ["email"]],
    [{ name: "", email: "" }, ["name", "email"]],
  ])("rejects %j", (input, fields) => {
    const result = validateLogin(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual([...fields].sort());
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

describe("loginUser", () => {
  const input = { name: "Jane", email: "jane@example.com" };

  it("returns the backend user as persisted", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json(200, { id: 7, ...input }));
    await expect(loginUser(input, { fetchImpl })).resolves.toEqual({ id: 7, ...input, persisted: true });
    const [path, init] = fetchImpl.mock.calls[0];
    expect(path).toBe("/api/session");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual(input);
  });

  it("signs in on this device only when no backend answers", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(loginUser(input, { fetchImpl })).resolves.toEqual({ id: null, ...input, persisted: false });
  });

  it("rethrows backend validation errors", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json(422, { detail: [] }));
    await expect(loginUser(input, { fetchImpl })).rejects.toBeInstanceOf(ApiError);
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
