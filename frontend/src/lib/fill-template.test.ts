import { describe, expect, it } from "vitest";
import {
  documentFilename,
  escapeMarkdown,
  fillTemplate,
  formatDate,
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
    expect(escapeMarkdown("Acme, Inc. - Suite #5 (HQ)")).toBe("Acme, Inc. - Suite #5 (HQ)");
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

  it("renders blank and invalid fields as a highlighted label", () => {
    const out = fillTemplate(body, fields, { effective_date: "", party_a_name: " ", term_years: "-3" });
    expect(out).toBe(
      "Dated `Effective date` by **`Party A legal name`** for `Agreement term (years)` year(s). {{unknown}}",
    );
  });
});

describe("documentFilename", () => {
  it("joins slugified parts and drops empty ones", () => {
    expect(documentFilename("Mutual-NDA", "Acme, Inc.", "Société Générale")).toBe(
      "Mutual-NDA_Acme-Inc_Societe-Generale",
    );
    expect(documentFilename("Mutual-NDA", "", "  ")).toBe("Mutual-NDA");
  });
});
