import { describe, expect, it, vi } from "vitest";
import { ApiError, ApiUnavailableError, apiRequest } from "./api-client";

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
    const error = await apiRequest("/api/session", { fetchImpl }).catch((e: unknown) => e);
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
    await expect(apiRequest("/api/session", { fetchImpl: makeFetch() })).rejects.toBeInstanceOf(ApiUnavailableError);
  });

  it("raises ApiUnavailableError when the request times out", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      (_, init) =>
        new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
    );
    await expect(apiRequest("/api/session", { fetchImpl, timeoutMs: 10 })).rejects.toBeInstanceOf(ApiUnavailableError);
  });
});
