# PreLegal frontend

Next.js app for PreLegal. It currently hosts the **Mutual NDA creator** prototype (PL-3): the user fills in a form, a live preview shows the Mutual Non-Disclosure Agreement with their details filled in, and the completed document can be downloaded as **PDF** or **Markdown**.

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
| `npm run build` | Production build (the page is prerendered as static HTML) |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests |

## How it works

- **Template data** is read from the repository's dataset at [`../data/templates`](../data/templates) (`catalog.json` + `mutual-nda.md`) by `src/lib/templates.ts`. The dataset is the single source of truth: the form is generated from the template's catalog fields, so changing a label, default or example there updates the app. Run the app from inside `frontend/` so the relative path resolves.
- **Filling** (`src/lib/fill-template.ts`) is plain `{{field_key}}` substitution. User input is Markdown-escaped, multi-line values are joined onto one line, and dates are formatted as e.g. "November 23, 2026". Blank fields render as highlighted labels in the preview.
- **UI** (`src/components/NdaBuilder.tsx`) keeps form state on the client and re-renders the Markdown preview with `react-markdown` + `remark-gfm` as the user types.
- **Downloads** are enabled once every required field is filled:
  - *Markdown*: the filled document as a `.md` file.
  - *PDF*: opens the browser's print dialog with print styles that show only the document; choose **Save as PDF**. The suggested file name is e.g. `Mutual-NDA_Acme-Inc_Globex-LLC`.

> ⚠️ The generated document is a general-purpose starting point, **not legal advice**.
