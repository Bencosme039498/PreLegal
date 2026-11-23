#!/usr/bin/env node
// Validates data/templates: every catalog entry points at an existing file, and the
// {{placeholders}} used in each template exactly match the fields declared in catalog.json.
// Usage: node scripts/validate-templates.mjs
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "templates");
const catalog = JSON.parse(readFileSync(join(dir, "catalog.json"), "utf8"));
const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;
const FIELD_TYPES = new Set(["text", "textarea", "address", "date", "integer", "money", "percent", "select"]);
const errors = [];

const ids = new Set();
const files = new Set();
for (const t of catalog.templates) {
  const where = `[${t.id}]`;
  if (ids.has(t.id)) errors.push(`${where} duplicate template id`);
  ids.add(t.id);
  files.add(t.file);

  const path = join(dir, t.file);
  if (!existsSync(path)) {
    errors.push(`${where} missing file ${t.file}`);
    continue;
  }
  const body = readFileSync(path, "utf8");
  const used = new Set([...body.matchAll(PLACEHOLDER)].map((m) => m[1]));
  const keys = new Set();
  for (const f of t.fields) {
    if (keys.has(f.key)) errors.push(`${where} duplicate field ${f.key}`);
    keys.add(f.key);
    if (!FIELD_TYPES.has(f.type)) errors.push(`${where} field ${f.key} has unknown type ${f.type}`);
    if (f.type === "select" && !(f.options?.length > 0)) errors.push(`${where} select field ${f.key} has no options`);
    if (!used.has(f.key)) errors.push(`${where} field ${f.key} is declared but never used`);
  }
  for (const k of used) if (!keys.has(k)) errors.push(`${where} placeholder {{${k}}} is not declared in catalog`);
  const malformed = body.match(/\{\{(?![a-z][a-z0-9_]*\}\})[^}]*\}\}/g);
  if (malformed) errors.push(`${where} malformed placeholders: ${malformed.join(", ")}`);
}

for (const f of readdirSync(dir)) {
  if (f.endsWith(".md") && f !== "README.md" && !files.has(f)) errors.push(`${f} is not listed in catalog.json`);
}

if (errors.length) {
  console.error(`Template validation failed:\n  - ${errors.join("\n  - ")}`);
  process.exit(1);
}
console.log(`OK: ${catalog.templates.length} templates validated.`);
