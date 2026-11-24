import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, ApiUnavailableError } from "./api-client";
import {
  chatFailure,
  chatStorageKey,
  clearChat,
  isChatAvailable,
  loadChat,
  parseStoredChat,
  saveChat,
  sendChat,
  supportsChat,
  type ChatMessage,
} from "./chat";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const html = (status: number) => new Response("<p>nope</p>", { status, headers: { "Content-Type": "text/html" } });
const fetchReturning = (res: Response) => vi.fn<typeof fetch>().mockResolvedValue(res);

const user = (content: string): ChatMessage => ({ role: "user", content });

describe("supportsChat", () => {
  it("is only the Mutual NDA for now", () => {
    expect(supportsChat("mutual-nda")).toBe(true);
    expect(supportsChat("unilateral-nda")).toBe(false);
  });
});

describe("sendChat", () => {
  it("posts the template, conversation and values and returns the turn", async () => {
    const result = { reply: "Who is Party B?", values: { party_a_name: "Acme" }, complete: false };
    const fetchImpl = fetchReturning(json(200, result));
    await expect(sendChat("mutual-nda", [user("Acme")], { term_years: "2" }, { fetchImpl })).resolves.toEqual(result);
    const [path, init] = fetchImpl.mock.calls[0];
    expect(path).toBe("/api/chat");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({
      template_id: "mutual-nda",
      messages: [{ role: "user", content: "Acme" }],
      values: { term_years: "2" },
    });
  });

  it("sends only the latest 30 messages", async () => {
    const fetchImpl = fetchReturning(json(200, { reply: "", values: {}, complete: false }));
    const messages = Array.from({ length: 35 }, (_, i) => user(`m${i}`));
    await sendChat("mutual-nda", messages, {}, { fetchImpl });
    const sent = JSON.parse(fetchImpl.mock.calls[0][1]?.body as string).messages as ChatMessage[];
    expect(sent.map((m) => m.content)).toEqual(messages.slice(5).map((m) => m.content));
  });

  it("surfaces a coded backend error as ApiError", async () => {
    const detail = { code: "llm_timeout", message: "Took too long.", retryable: true };
    const error = await sendChat("mutual-nda", [user("hi")], {}, { fetchImpl: fetchReturning(json(504, { detail })) }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(chatFailure(error)).toEqual(detail);
  });
});

describe("isChatAvailable", () => {
  it("is true when the backend answers the health check", async () => {
    const fetchImpl = fetchReturning(json(200, { status: "ok" }));
    await expect(isChatAvailable({ fetchImpl })).resolves.toBe(true);
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/health");
  });

  it.each([
    ["a static host 404", () => fetchReturning(html(404))],
    ["a network failure", () => vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"))],
  ])("is false for %s", async (_, makeFetch) => {
    await expect(isChatAvailable({ fetchImpl: makeFetch() })).resolves.toBe(false);
  });
});

describe("chatFailure", () => {
  it("uses the backend's envelope", () => {
    const detail = { code: "llm_not_configured", message: "Not configured.", retryable: false };
    expect(chatFailure(new ApiError(503, detail))).toEqual(detail);
  });

  it("treats other API errors (e.g. 422 validation) as not retryable", () => {
    expect(chatFailure(new ApiError(422, [{ loc: ["body"] }]))).toMatchObject({ code: "invalid_request", retryable: false });
  });

  it("treats an unreachable backend as a retryable network error", () => {
    expect(chatFailure(new ApiUnavailableError())).toMatchObject({ code: "network", retryable: true });
  });

  it("has a fallback for anything else", () => {
    expect(chatFailure(new Error("?"))).toMatchObject({ code: "unknown", retryable: true });
  });
});

describe("parseStoredChat", () => {
  const keys = ["party_a_name", "term_years"];

  it("round-trips messages and values", () => {
    const chat = { messages: [user("hi"), { role: "assistant" as const, content: "hello" }], values: { party_a_name: "Acme" } };
    expect(parseStoredChat(JSON.stringify(chat), keys)).toEqual(chat);
  });

  it("drops malformed messages and unknown or non-string values", () => {
    const raw = JSON.stringify({
      messages: [user("ok"), { role: "system", content: "x" }, { role: "user" }, null, "text"],
      values: { party_a_name: "Acme", term_years: 2, injected: "x" },
    });
    expect(parseStoredChat(raw, keys)).toEqual({ messages: [user("ok")], values: { party_a_name: "Acme" } });
  });

  it.each([null, "", "not json", "null", "[]", '{"messages":"x","values":{}}', '{"messages":[]}'])(
    "returns null for %j",
    (raw) => {
      expect(parseStoredChat(raw, keys)).toBeNull();
    },
  );
});

describe("chat storage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("saves, loads and clears per user and template", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
    const key = chatStorageKey("jane@example.com", "mutual-nda");
    expect(key).not.toBe(chatStorageKey("bob@example.com", "mutual-nda"));

    saveChat(key, { messages: [user("hi")], values: { party_a_name: "Acme" } });
    expect(loadChat(key, ["party_a_name"])).toEqual({ messages: [user("hi")], values: { party_a_name: "Acme" } });
    clearChat(key);
    expect(loadChat(key, ["party_a_name"])).toBeNull();
  });

  it("never throws when storage is blocked", () => {
    const blocked = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    vi.stubGlobal("window", { sessionStorage: { getItem: blocked, setItem: blocked, removeItem: blocked } });
    expect(loadChat("k", [])).toBeNull();
    expect(() => saveChat("k", { messages: [], values: {} })).not.toThrow();
    expect(() => clearChat("k")).not.toThrow();
  });
});
