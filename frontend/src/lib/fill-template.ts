// Pure, framework-free helpers for turning a template from data/templates into a
// filled-in Markdown document. Shared by the server (types) and the client (rendering).

export type FieldType =
  | "text"
  | "textarea"
  | "address"
  | "date"
  | "integer"
  | "money"
  | "percent"
  | "select";

/** A field as declared in data/templates/catalog.json. */
export interface TemplateField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  default?: string | number;
  example?: string;
  options?: string[];
}

export type FieldValues = Record<string, string>;

const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;

/** Initial form values: each field's catalog default, or an empty string. */
export function initialValues(fields: TemplateField[]): FieldValues {
  return Object.fromEntries(fields.map((f) => [f.key, f.default === undefined ? "" : String(f.default)]));
}

/** Whether a value can be put into the document: non-blank, and a whole number for integer fields. */
export function isFilled(field: TemplateField, value = ""): boolean {
  const v = value.trim();
  return field.type === "integer" ? /^\d+$/.test(v) : v !== "";
}

/** Whether a non-blank value is unusable, e.g. "-3" or "1.5" in an integer field. */
export function isInvalid(field: TemplateField, value = ""): boolean {
  return value.trim() !== "" && !isFilled(field, value);
}

/** Fields that still need attention: required ones not yet filled, plus any invalid value. */
export function incompleteFields(fields: TemplateField[], values: FieldValues): TemplateField[] {
  return fields.filter((f) => (f.required && !isFilled(f, values[f.key])) || isInvalid(f, values[f.key]));
}

/** Formats an ISO `YYYY-MM-DD` date as e.g. "November 23, 2026"; other input is returned as-is. */
export function formatDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const [, y, m, d] = match.map(Number);
  // Build in UTC and format in UTC so the day never shifts with the viewer's time zone.
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

/**
 * Escapes one line of user input so it always renders literally while the raw
 * .md stays readable:
 * - inline formatting characters (`*`, `_`, `|`, …) and HTML entities (`&copy;`);
 * - block syntax at the start of the line (`#`, `>`, `-`, `+`, `=`, `1.`), since
 *   some placeholders begin a line (e.g. `{{deliverables}}`), where "# x" would
 *   become a heading and "1. x" a list. The escape is harmless mid-line.
 */
export function escapeMarkdown(line: string): string {
  return line
    .replace(/[\\`*_\[\]<>|~]/g, "\\$&")
    .replace(/&(?=#?\w+;)/g, "\\&")
    .replace(/^([#>+=-])/, "\\$1")
    .replace(/^(\d+)([.)])/, "$1\\$2");
}

/** Non-empty, trimmed lines of user input. */
function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Joins multi-line input (e.g. an address) into one line, so it fits the
 * sentence or table cell it is placed in:
 * "1 Main St\nSpringfield, IL" -> "1 Main St, Springfield, IL".
 */
export function singleLine(text: string): string {
  return lines(text)
    .map((line) => line.replace(/,$/, ""))
    .join(", ");
}

/**
 * Formats a filled value for the document. Free-text `textarea` fields (scope,
 * deliverables, schedules) keep their line breaks, which the preview renders as
 * <br> via remark-breaks; every other type is joined onto one line.
 */
function formatValue(field: TemplateField, raw: string): string {
  if (field.type === "textarea") return lines(raw).map(escapeMarkdown).join("\n");
  const value = singleLine(raw);
  return escapeMarkdown(field.type === "date" ? formatDate(value) : value);
}

/**
 * Replaces every `{{key}}` in `body` with the user's value for that field.
 * Blank or invalid fields are rendered as an inline-code span holding the field
 * label (e.g. `` `Party A legal name` ``) so the preview can highlight them.
 */
export function fillTemplate(body: string, fields: TemplateField[], values: FieldValues): string {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  return body.replace(PLACEHOLDER, (placeholder, key: string) => {
    const field = byKey.get(key);
    if (!field) return placeholder;
    const raw = values[key] ?? "";
    return isFilled(field, raw) ? formatValue(field, raw) : `\`${field.label}\``;
  });
}

/** A filesystem-safe download name, e.g. "Promissory-Note_Acme-Inc_Globex-LLC". */
export function documentFilename(...parts: string[]): string {
  const slug = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/\p{M}/gu, "") // strip combining accents left by NFKD
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  return parts.map(slug).filter(Boolean).join("_");
}

export interface FieldSection {
  title: string;
  fields: TemplateField[];
  /** For a party section, the key of the party's name field (used in file names). */
  nameKey?: string;
}

const titleCase = (prefix: string) => prefix.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

/**
 * Groups a template's fields into form sections: one per party, then "Details".
 *
 * Parties are inferred from the catalog's naming convention: a `<party>_name`
 * field plus at least one other `<party>_…` field (e.g. `client_name`,
 * `client_address`). Nested prefixes such as `party_a_signatory` stay inside
 * their party (`party_a`), and lone fields like `company_name` go to "Details".
 */
export function groupFields(fields: TemplateField[]): FieldSection[] {
  const keys = fields.map((f) => f.key);
  const candidates = keys
    .filter((k) => k.endsWith("_name"))
    .map((k) => k.slice(0, -"_name".length))
    .filter((p) => keys.filter((k) => k.startsWith(`${p}_`)).length >= 2);
  const parties = candidates.filter((p) => !candidates.some((q) => q !== p && p.startsWith(`${q}_`)));

  const sections: FieldSection[] = [];
  const details: FieldSection = { title: "Details", fields: [] };
  for (const field of fields) {
    const party = parties.find((p) => field.key.startsWith(`${p}_`));
    if (!party) {
      details.fields.push(field);
      continue;
    }
    let section = sections.find((s) => s.nameKey === `${party}_name`);
    if (!section) sections.push((section = { title: titleCase(party), fields: [], nameKey: `${party}_name` }));
    section.fields.push(field);
  }
  return details.fields.length ? [...sections, details] : sections;
}
