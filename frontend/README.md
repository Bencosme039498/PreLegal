# PreLegal frontend

Next.js app for PreLegal: a **document creator for every template in the catalog** (PL-3, PL-4). The user picks a template, fills in a form, sees a live preview of the agreement with their details filled in, and downloads the completed document as **PDF** or **Markdown**.

It is built as a **static export** (`output: "export"` in `next.config.ts`): `npm run build` writes plain HTML/JS to `out/`, which the FastAPI backend serves at <http://localhost:8000> (PL-6) and Vercel hosts as a static site.

| Route | Page |
| --- | --- |
| `/login/` | Sign-in screen (fake sign-in: name + email, no password) |
| `/` | List of all templates in `data/templates/catalog.json` (signed-in users) |
| `/templates/<id>/` | Creator for one template, e.g. `/templates/mutual-nda/` (signed-in users) |

URLs end in `/` (`trailingSlash: true`), so each page is exported as `route/index.html`; paths without the slash redirect.

## Getting started

Requires Node.js 22+. To run the whole app (frontend + backend) use the Docker scripts described in the [root README](../README.md). For frontend-only work:

```sh
cd frontend
npm install
npm run dev     # http://localhost:3000
```

Without the backend, sign-in still works but is kept on this device only (see below).

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Static export to `out/` (every page is prerendered as HTML) |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests |

## How it works

- **Template data** is read from the repository's dataset at [`../data/templates`](../data/templates) by `src/lib/templates.ts` at build time. The dataset is the single source of truth: adding a template to `catalog.json` adds a page, and the form is generated from the template's catalog fields (label, type, default, example, options). Run the app from inside `frontend/` so the relative path resolves (the Dockerfile keeps `data/` next to `frontend/` for the same reason).
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

## Sign-in (PL-6)

A placeholder for real authentication (PL-9): it identifies the user but checks no password.

- App pages live in the `src/app/(app)/` route group, whose layout wraps them in `RequireSession`: visitors without a session are sent to `/login/`. The check runs in the browser (a static export has no server), and pages render only once the session is known, so signed-out visitors never see app content.
- `LoginForm` validates the name and email (`validateLogin` in `src/lib/session.ts`) and calls `POST /api/session`, which records the user in the backend's temporary database. The user is then kept in `localStorage` (`useSession` reads it with `useSyncExternalStore`, in sync across tabs).
- If no backend answers (`npm run dev`, or the static Vercel deployment), `src/lib/api-client.ts` reports the API as unavailable and the user is signed in on this device only, shown as "(this device only)" in the header.
- **Sign out** clears the session and returns to `/login/`.

## Colors

The palette from the project spec is defined as Tailwind theme tokens in `src/app/globals.css`: `brand-yellow` (accent), `brand-blue` (links, focus), `brand-purple` (primary/submit buttons), `brand-navy` (headings), `brand-gray` (tertiary text; ~3.5:1 contrast on white, so not for small body text).

> ⚠️ The generated documents are general-purpose starting points, **not legal advice**.
