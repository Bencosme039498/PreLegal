import { describe, expect, it } from "vitest";
import catalog from "../../../data/templates/catalog.json";
import {
  documentFilename,
  escapeMarkdown,
  fillTemplate,
  formatDate,
  groupFields,
  incompleteFields,
  initialValues,
  isFilled,
  singleLine,
  type TemplateField,
} from "./fill-template";

const fields: TemplateField[] = [
  { key: "effective_date", label: "Effective date", type: "date", required: true },
  { key: "party_a_name", label: "Party A legal name", type: "text", required: true },
  { key: "term_years", label: "Agreement term (years)", type: "integer", required: true, default: 2 },
  { key: "notes", label: "Notes", type: "textarea", required: false },
];
const catalogFields = (id: string) => catalog.templates.find((t) => t.id === id)!.fields as TemplateField[];

describe("initialValues", () => {
  it("uses catalog defaults and blanks elsewhere", () => {
    expect(initialValues(fields)).toEqual({ effective_date: "", party_a_name: "", term_years: "2", notes: "" });
  });
});

describe("isFilled", () => {
  const [, text, integer] = fields;

  it("requires non-blank text", () => {
    expect(isFilled(text, "Acme")).toBe(true);
    expect(isFilled(text, "  ")).toBe(false);
    expect(isFilled(text, undefined)).toBe(false);
  });

  it("requires a non-negative whole number for integer fields", () => {
    expect(isFilled(integer, " 3 ")).toBe(true);
    expect(isFilled(integer, "0")).toBe(true);
    for (const bad of ["-3", "1.5", "1e3", ""]) expect(isFilled(integer, bad)).toBe(false);
  });
});

describe("incompleteFields", () => {
  it("lists required fields that are blank and any field with an invalid value", () => {
    const incomplete = incompleteFields(fields, {
      effective_date: "2026-11-23",
      party_a_name: "  ",
      term_years: "-3",
      notes: "",
    });
    expect(incomplete.map((f) => f.key)).toEqual(["party_a_name", "term_years"]);
  });
});

describe("formatDate", () => {
  it("formats ISO dates in long US form without time-zone drift", () => {
    expect(formatDate("2026-11-23")).toBe("November 23, 2026");
    expect(formatDate("2027-01-01")).toBe("January 1, 2027");
  });

  it("returns non-ISO input unchanged", () => {
    expect(formatDate("next Tuesday")).toBe("next Tuesday");
  });
});

describe("escapeMarkdown", () => {
  it("escapes inline formatting characters", () => {
    expect(escapeMarkdown("A*B_C|D [x] `y` <z> ~w")).toBe("A\\*B\\_C\\|D \\[x\\] \\`y\\` \\<z\\> \\~w");
  });

  it("leaves ordinary punctuation readable", () => {
    expect(escapeMarkdown("Acme, Inc. - Suite #5 (HQ) & Sons")).toBe("Acme, Inc. - Suite #5 (HQ) & Sons");
  });

  it("escapes HTML entities so they are not decoded", () => {
    expect(escapeMarkdown("&copy; &#169;")).toBe(String.raw`\&copy; \&#169;`);
  });

  it("escapes block syntax at the start of a line", () => {
    expect(escapeMarkdown("# Phase 1")).toBe(String.raw`\# Phase 1`);
    expect(escapeMarkdown("- item")).toBe(String.raw`\- item`);
    expect(escapeMarkdown("> quote")).toBe(String.raw`\> quote`);
    expect(escapeMarkdown("---")).toBe(String.raw`\---`);
    expect(escapeMarkdown("===")).toBe(String.raw`\===`);
    expect(escapeMarkdown("1. First")).toBe(String.raw`1\. First`);
    expect(escapeMarkdown("2) Second")).toBe(String.raw`2\) Second`);
    expect(escapeMarkdown("2026 budget")).toBe("2026 budget");
  });
});

describe("singleLine", () => {
  it("joins lines with commas so multi-line input stays in its paragraph or table cell", () => {
    expect(singleLine("1 Main St,\r\n  Springfield, IL\n\nUSA  ")).toBe("1 Main St, Springfield, IL, USA");
    expect(singleLine("  Acme Inc.  ")).toBe("Acme Inc.");
  });
});

describe("fillTemplate", () => {
  const body = "Dated {{effective_date}} by **{{party_a_name}}** for {{ term_years }} year(s). {{unknown}}";

  it("substitutes formatted, escaped values", () => {
    const out = fillTemplate(body, fields, {
      effective_date: "2026-11-23",
      party_a_name: "Acme_Co *Ltd*",
      term_years: "3",
    });
    expect(out).toBe("Dated November 23, 2026 by **Acme\\_Co \\*Ltd\\*** for 3 year(s). {{unknown}}");
  });

  it("keeps line breaks in textarea values, escaping each line", () => {
    const notes = ["1. Kickoff", "", "  - Design *v1*  ", "Done"].join("\r\n");
    const out = fillTemplate("{{notes}}", fields, { notes });
    expect(out).toBe([String.raw`1\. Kickoff`, String.raw`\- Design \*v1\*`, "Done"].join("\n"));
  });

  it("renders blank and invalid fields as a highlighted label", () => {
    const out = fillTemplate(body, fields, { effective_date: "", party_a_name: " ", term_years: "-3" });
    expect(out).toBe(
      "Dated `Effective date` by **`Party A legal name`** for `Agreement term (years)` year(s). {{unknown}}",
    );
  });
});

describe("documentFilename", () => {
  it("joins slugified parts and drops empty ones", () => {
    expect(documentFilename("Mutual Non-Disclosure Agreement", "Acme, Inc.", "Société Générale")).toBe(
      "Mutual-Non-Disclosure-Agreement_Acme-Inc_Societe-Generale",
    );
    expect(documentFilename("Promissory Note", "", "  ")).toBe("Promissory-Note");
  });
});

describe("groupFields", () => {
  const titles = (id: string) => groupFields(catalogFields(id)).map((s) => s.title);

  it("groups each catalog template into its parties plus Details", () => {
    expect(titles("mutual-nda")).toEqual(["Party A", "Party B", "Details"]);
    expect(titles("unilateral-nda")).toEqual(["Discloser", "Recipient", "Details"]);
    expect(titles("independent-contractor-agreement")).toEqual(["Client", "Contractor", "Details"]);
    expect(titles("consulting-services-agreement")).toEqual(["Client", "Consultant", "Details"]);
    expect(titles("employment-offer-letter")).toEqual(["Candidate", "Hiring Manager", "Details"]);
    expect(titles("ip-assignment-agreement")).toEqual(["Assignor", "Assignee", "Details"]);
    expect(titles("promissory-note")).toEqual(["Borrower", "Lender", "Details"]);
    expect(titles("general-release")).toEqual(["Releasor", "Releasee", "Details"]);
  });

  it("keeps nested prefixes inside their party and every field exactly once", () => {
    const fields = catalogFields("mutual-nda");
    const sections = groupFields(fields);
    expect(sections[0].fields.map((f) => f.key)).toEqual([
      "party_a_name",
      "party_a_entity_type",
      "party_a_address",
      "party_a_signatory_name",
      "party_a_signatory_title",
    ]);
    expect(sections[0].nameKey).toBe("party_a_name");
    expect(sections.flatMap((s) => s.fields).length).toBe(fields.length);
  });

  it("puts lone *_name fields in Details", () => {
    const details = groupFields(catalogFields("employment-offer-letter")).at(-1)!;
    expect(details.fields.map((f) => f.key)).toEqual(expect.arrayContaining(["company_name", "manager_name"]));
  });
});
