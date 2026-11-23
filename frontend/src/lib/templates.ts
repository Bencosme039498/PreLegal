import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TemplateField } from "./fill-template";

// The template dataset lives at the repository root (../data/templates) and is the
// single source of truth; the frontend reads it rather than keeping a copy.
const TEMPLATES_DIR = join(process.cwd(), "..", "data", "templates");

/** A template's catalog entry (data/templates/catalog.json). */
export interface TemplateSummary {
  id: string;
  name: string;
  category: string;
  description: string;
  file: string;
  fields: TemplateField[];
}

export interface Template extends TemplateSummary {
  /** Markdown with `{{field_key}}` placeholders. */
  body: string;
}

// Synchronous reads are prerendered by Next.js at build time, so every page
// that uses them ships as static HTML.
function readCatalog(): TemplateSummary[] {
  return (JSON.parse(readFileSync(join(TEMPLATES_DIR, "catalog.json"), "utf8")) as { templates: TemplateSummary[] })
    .templates;
}

/** All templates in catalog order. */
export function listTemplates(): TemplateSummary[] {
  return readCatalog();
}

/** A template's metadata, fields and Markdown body, or `undefined` if the id is unknown. */
export function loadTemplate(id: string): Template | undefined {
  const entry = readCatalog().find((t) => t.id === id);
  if (!entry) return undefined;
  return { ...entry, body: readFileSync(join(TEMPLATES_DIR, entry.file), "utf8") };
}
