import { describe, expect, it } from "vitest";
import { DISCLAIMER, DISCLAIMER_TITLE, withDisclaimer } from "./disclaimer";

describe("withDisclaimer", () => {
  it("puts the draft notice at the top of the Markdown download", () => {
    const md = "# Mutual NDA\n\nBody";
    const out = withDisclaimer(md);
    expect(out.startsWith(`> **${DISCLAIMER_TITLE}.** ${DISCLAIMER}\n\n`)).toBe(true);
    expect(out.endsWith(md)).toBe(true);
  });

  it("says the document is a draft subject to legal review", () => {
    expect(DISCLAIMER).toMatch(/draft/);
    expect(DISCLAIMER).toMatch(/not legal advice/);
    expect(DISCLAIMER).toMatch(/review by a qualified attorney/);
  });
});
