import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api-client";
import {
  createDocument,
  deleteDocument,
  documentHref,
  documentTitle,
  formatUpdatedAt,
  getDocument,
  listDocuments,
  parseDocId,
  updateDocument,
} from "./documents";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const content = { title: "Acme Inc", values: { party_a_name: "Acme Inc" }, messages: [{ role: "user" as const, content: "hi" }] };

describe("documents client", () => {
  it("lists, gets, creates, updates and deletes", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(200, []))
      .mockResolvedValueOnce(json(200, { id: 3 }))
      .mockResolvedValueOnce(json(201, { id: 4 }))
      .mockResolvedValueOnce(json(200, { id: 4 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(listDocuments({ fetchImpl })).resolves.toEqual([]);
    await expect(getDocument(3, { fetchImpl })).resolves.toEqual({ id: 3 });
    await createDocument("mutual-nda", content, { fetchImpl });
    await updateDocument(4, content, { fetchImpl });
    await expect(deleteDocument(4, { fetchImpl })).resolves.toBeUndefined();

    const calls = fetchImpl.mock.calls.map(([path, init]) => [path, init?.method ?? "GET"]);
    expect(calls).toEqual([
      ["/api/documents", "GET"],
      ["/api/documents/3", "GET"],
      ["/api/documents", "POST"],
      ["/api/documents/4", "PUT"],
      ["/api/documents/4", "DELETE"],
    ]);
    expect(JSON.parse(fetchImpl.mock.calls[2][1]?.body as string)).toEqual({ template_id: "mutual-nda", ...content });
    expect(JSON.parse(fetchImpl.mock.calls[3][1]?.body as string)).toEqual(content);
  });

  it("rejects a missing document with its coded error", async () => {
    const detail = { code: "document_not_found", message: "Gone.", retryable: false };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json(404, { detail }));
    const error = await getDocument(9, { fetchImpl }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).detail).toEqual(detail);
  });
});

describe("document addresses", () => {
  it("puts the id in the query string (the site is a static export)", () => {
    expect(documentHref("mutual-nda", 12)).toBe("/templates/mutual-nda/?doc=12");
  });

  it.each([
    ["?doc=12", 12],
    ["?x=1&doc=7", 7],
    ["", null],
    ["?doc=", null],
    ["?doc=0", null],
    ["?doc=-3", null],
    ["?doc=1.5", null],
    ["?doc=abc", null],
    ["?doc=99999999999999999", null],
  ])("parseDocId(%j) is %j", (search, id) => {
    expect(parseDocId(search)).toBe(id);
  });
});

describe("documentTitle", () => {
  it("joins the known party names", () => {
    expect(documentTitle(["Acme Inc", "Globex  LLC "])).toBe("Acme Inc & Globex LLC");
    expect(documentTitle(["", "Globex"])).toBe("Globex");
    expect(documentTitle([undefined, "  "])).toBe("");
    expect(documentTitle(["x".repeat(300)])).toHaveLength(200);
  });
});

describe("formatUpdatedAt", () => {
  it("formats an ISO time, and is blank for garbage", () => {
    expect(formatUpdatedAt("2026-11-24T14:05:00.000Z", "en-GB")).toMatch(/24 Nov 2026/);
    expect(formatUpdatedAt("nope")).toBe("");
  });
});
