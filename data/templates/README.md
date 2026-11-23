# Legal Document Templates

This directory holds the dataset of legal document templates that PreLegal fills in and modifies for users.

> ⚠️ These templates are general-purpose starting points written for PreLegal. They are **not legal advice**. They have not been tailored to any jurisdiction, so a qualified attorney should review them before real use.

## Contents

| ID | Document | Category |
| --- | --- | --- |
| `mutual-nda` | Mutual Non-Disclosure Agreement | confidentiality |
| `unilateral-nda` | Unilateral Non-Disclosure Agreement | confidentiality |
| `independent-contractor-agreement` | Independent Contractor Agreement | services |
| `consulting-services-agreement` | Consulting Services Agreement | services |
| `employment-offer-letter` | Employment Offer Letter | employment |
| `ip-assignment-agreement` | Intellectual Property Assignment Agreement | intellectual-property |
| `promissory-note` | Promissory Note | finance |
| `general-release` | General Release of Claims | disputes |

## Structure

- **`<id>.md`**: the template body in Markdown. Values the user supplies are written as placeholders using the `{{field_key}}` syntax (for example `{{effective_date}}`).
- **`catalog.json`**: the machine-readable index. For each template it lists metadata (name, category, description, file) and every field: its `key`, `label`, `type`, whether it is `required`, plus an optional `default`, `example`, or `options` (for `select` fields).
- **`catalog.schema.json`**: the JSON Schema for `catalog.json`.

### Field types

| Type | Meaning |
| --- | --- |
| `text` | Short single-line text |
| `textarea` | Multi-line free text (scopes, descriptions, schedules) |
| `address` | Postal address |
| `date` | Calendar date |
| `integer` | Whole number (days, years) |
| `money` | Monetary amount including currency |
| `percent` | Percentage rate |
| `select` | One of a fixed set of `options` |

## Rendering

To produce a document, the system replaces each `{{field_key}}` with the user's value for that field. Templates use only plain substitution: no conditionals and no loops. Because of that, the system or an LLM can modify the rendered Markdown freely afterwards (for example, to add or remove clauses at the user's request).

## Adding or changing a template

1. Add or edit `<id>.md` using `{{snake_case}}` placeholders.
2. Add or update its entry in `catalog.json` so that the declared fields exactly match the placeholders used.
3. Run the validator:

   ```sh
   node scripts/validate-templates.mjs
   ```

   It fails in any of these cases: a placeholder is undeclared, a declared field is unused, a template file is missing, or a `.md` file is not in the catalog.
