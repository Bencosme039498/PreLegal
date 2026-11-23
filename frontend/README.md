# PreLegal frontend

Next.js app for PreLegal: a **document creator for every template in the catalog** (PL-3, PL-4). The user picks a template, fills in a form, sees a live preview of the agreement with their details filled in, and downloads the completed document as **PDF** or **Markdown**.

| Route | Page |
| --- | --- |
| `/` | List of all templates in `data/templates/catalog.json` |
| `/templates/<id>` | Creator for one template, e.g. `/templates/mutual-nda` |

## Getting started

Requires Node.js 22+.

```sh
cd frontend
npm install
npm run dev     # http://localhost:3000
```

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build (every page is prerendered as static HTML) |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests |

## How it works

- **Template data** is read from the repository's dataset at [`../data/templates`](../data/templates) by `src/lib/templates.ts`. The dataset is the single source of truth: adding a template to `catalog.json` adds a page, and the form is generated from the template's catalog fields (label, type, default, example, options). Run the app from inside `frontend/` so the relative path resolves.
- **Form sections** (`groupFields` in `src/lib/fill-template.ts`) are inferred from the catalog's field naming: a `<party>_name` field plus other `<party>_…` fields form a party section (e.g. *Client*, *Contractor*); everything else goes under *Details*. The first two parties' names are used in download file names.
- **Filling** (`fillTemplate`) is plain `{{field_key}}` substitution:
  - user input is Markdown-escaped, including block syntax at the start of a line, so it always renders literally;
  - `textarea` values (scope, deliverables, schedules) keep their line breaks; other multi-line values (addresses) are joined with commas;
  - dates are formatted as e.g. "November 23, 2026"; integer fields must be whole numbers ≥ 0;
  - blank or invalid fields render as highlighted labels in the preview.
- **UI** (`src/components/DocumentBuilder.tsx`) keeps form state on the client and re-renders the preview with `react-markdown` + `remark-gfm` + `remark-breaks` (so line-by-line blocks like addresses and signature lines render as written).
- **Downloads** are enabled once every field is complete and valid:
  - *Markdown*: the filled document as a `.md` file.
  - *PDF*: opens the browser's print dialog with print styles that show only the document; choose **Save as PDF**. The suggested file name is e.g. `Mutual-Non-Disclosure-Agreement_Acme-Inc_Globex-LLC`.

> ⚠️ The generated documents are general-purpose starting points, **not legal advice**.
