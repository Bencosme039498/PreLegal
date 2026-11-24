import { describe, expect, it, vi } from "vitest";
import { ApiError, ApiUnavailableError, apiRequest, isErrorEnvelope, setUnauthenticatedHandler } from "./api-client";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const html = (status: number) => new Response("<!doctype html><p>Not found</p>", { status, headers: { "Content-Type": "text/html" } });
const fetchReturning = (res: Response) => vi.fn<typeof fetch>().mockResolvedValue(res);

describe("apiRequest", () => {
  it("returns the parsed JSON body and sends JSON headers", async () => {
    const fetchImpl = fetchReturning(json(200, { status: "ok" }));
    await expect(apiRequest("/api/health", { fetchImpl })).resolves.toEqual({ status: "ok" });
    const [path, init] = fetchImpl.mock.calls[0];
    expect(path).toBe("/api/health");
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("raises ApiError with the detail for a JSON 4xx such as 422", async () => {
    const fetchImpl = fetchReturning(json(422, { detail: [{ loc: ["body", "email"] }] }));
    const error = await apiRequest("/api/documents", { fetchImpl }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(422);
    expect((error as ApiError).detail).toEqual([{ loc: ["body", "email"] }]);
  });

  it.each([
    ["a network failure", () => vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"))],
    ["an HTML 404 from a static host", () => fetchReturning(html(404))],
    ["an HTML 405 from a static host", () => fetchReturning(html(405))],
    ["an HTML 200 (SPA fallback)", () => fetchReturning(html(200))],
    ["a JSON 404", () => fetchReturning(json(404, { detail: "Not found" }))],
    ["a 500", () => fetchReturning(json(500, { detail: "boom" }))],
    [
      "a malformed JSON body",
      () => fetchReturning(new Response("{not json", { status: 200, headers: { "Content-Type": "application/json" } })),
    ],
  ])("raises ApiUnavailableError for %s", async (_, makeFetch) => {
    await expect(apiRequest("/api/documents", { fetchImpl: makeFetch() })).rejects.toBeInstanceOf(ApiUnavailableError);
  });

  it("raises ApiUnavailableError when the request times out", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      (_, init) =>
        new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
    );
    await expect(apiRequest("/api/documents", { fetchImpl, timeoutMs: 10 })).rejects.toBeInstanceOf(ApiUnavailableError);
  });

  it.each([404, 429, 502, 503, 504])("raises ApiError for a coded error envelope with status %i", async (status) => {
    const detail = { code: "llm_timeout", message: "Took too long.", retryable: true };
    const error = await apiRequest("/api/chat", { fetchImpl: fetchReturning(json(status, { detail })) }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(status);
    expect((error as ApiError).detail).toEqual(detail);
  });

  it("still treats a 5xx without an envelope as unavailable", async () => {
    const fetchImpl = fetchReturning(json(503, { detail: { code: "x" } })); // incomplete envelope
    await expect(apiRequest("/api/chat", { fetchImpl })).rejects.toBeInstanceOf(ApiUnavailableError);
  });

  it("aborts when the caller's signal aborts", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      (_, init) =>
        new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
    );
    const controller = new AbortController();
    const pending = apiRequest("/api/chat", { fetchImpl, signal: controller.signal, timeoutMs: 60_000 });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(ApiUnavailableError);
  });

  it("combines the caller's signal and the timeout without AbortSignal.any (older browsers)", async () => {
    vi.stubGlobal("AbortSignal", Object.assign(Object.create(AbortSignal), { any: undefined, timeout: AbortSignal.timeout }));
    try {
      const fetchImpl = vi.fn<typeof fetch>(
        (_, init) =>
          new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
      );
      const controller = new AbortController();
      const pending = apiRequest("/api/chat", { fetchImpl, signal: controller.signal, timeoutMs: 60_000 });
      controller.abort();
      await expect(pending).rejects.toBeInstanceOf(ApiUnavailableError);
      await expect(apiRequest("/api/chat", { fetchImpl, signal: new AbortController().signal, timeoutMs: 10 })).rejects.toBeInstanceOf(
        ApiUnavailableError,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("isErrorEnvelope", () => {
  it.each([
    [{ code: "a", message: "b", retryable: false }, true],
    [{ code: "a", message: "b" }, false],
    [{ code: 1, message: "b", retryable: true }, false],
    ["Not found", false],
    [null, false],
    [[{ loc: ["body"] }], false],
  ])("%j -> %s", (detail, expected) => {
    expect(isErrorEnvelope(detail)).toBe(expected);
  });
});

describe("apiRequest and accounts", () => {
  const envelope = (code: string) => ({ detail: { code, message: "m", retryable: false } });

  it("returns nothing for 204 No Content", async () => {
    await expect(apiRequest("/api/auth/logout", { fetchImpl: fetchReturning(new Response(null, { status: 204 })) })).resolves.toBeUndefined();
  });

  it("tells the unauthenticated handler when the session has ended, not for a wrong password", async () => {
    const handler = vi.fn();
    const unsubscribe = setUnauthenticatedHandler(handler);
    await expect(apiRequest("/api/chat", { fetchImpl: fetchReturning(json(401, envelope("not_authenticated"))) })).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledTimes(1);
    await expect(apiRequest("/api/auth/login", { fetchImpl: fetchReturning(json(401, envelope("invalid_credentials"))) })).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();
    await apiRequest("/api/chat", { fetchImpl: fetchReturning(json(401, envelope("not_authenticated"))) }).catch(() => {});
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("an older unsubscribe doesn't remove a newer handler", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = setUnauthenticatedHandler(first);
    const unsubscribeSecond = setUnauthenticatedHandler(second);
    unsubscribeFirst();
    await apiRequest("/api/chat", { fetchImpl: fetchReturning(json(401, envelope("not_authenticated"))) }).catch(() => {});
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    unsubscribeSecond();
  });
});
