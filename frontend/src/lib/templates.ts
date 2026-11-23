import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TemplateField } from "./fill-template";

// The template dataset lives at the repository root (../data/templates) and is the
// single source of truth; the frontend reads it rather than keeping a copy.
const TEMPLATES_DIR = join(process.cwd(), "..", "data", "templates");

interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  file: string;
  fields: TemplateField[];
}

export interface Template {
  id: string;
  name: string;
  description: string;
  fields: TemplateField[];
  body: string;
}

/**
 * Loads a template's metadata, fields and Markdown body. Uses synchronous reads,
 * which Next.js prerenders at build time, so the page ships as static HTML.
 */
export function loadTemplate(id: string): Template {
  const catalog = JSON.parse(readFileSync(join(TEMPLATES_DIR, "catalog.json"), "utf8")) as {
    templates: CatalogEntry[];
  };
  const entry = catalog.templates.find((t) => t.id === id);
  if (!entry) throw new Error(`Template "${id}" not found in catalog.json`);

  const body = readFileSync(join(TEMPLATES_DIR, entry.file), "utf8");
  return { id: entry.id, name: entry.name, description: entry.description, fields: entry.fields, body };
}
