# PreLegal
A platform for drafting common legal agreements

**🌐 Live site: <https://prelegal-blue.vercel.app>**

PreLegal is a generic document creator: pick any template, fill in a form, watch the agreement update live as you type, and download the completed document as PDF or Markdown. The forms and documents come straight from the template dataset in [`data/templates`](data/templates), so adding a template to the catalog adds it to the site.

> 🚧 **Status: In progress.** This project is under active development and is expected to be completed within 1 week (target: November 28, 2026).

## What you can draft

| Document | Category | Description |
| --- | --- | --- |
| [Mutual Non-Disclosure Agreement](https://prelegal-blue.vercel.app/templates/mutual-nda) | confidentiality | Two-way NDA for parties that will both share confidential information, e.g. when exploring a partnership. |
| [Unilateral Non-Disclosure Agreement](https://prelegal-blue.vercel.app/templates/unilateral-nda) | confidentiality | One-way NDA where only one party discloses confidential information to the other. |
| [Independent Contractor Agreement](https://prelegal-blue.vercel.app/templates/independent-contractor-agreement) | services | Engages an individual or business as an independent contractor, with IP assignment and confidentiality. |
| [Consulting Services Agreement](https://prelegal-blue.vercel.app/templates/consulting-services-agreement) | services | Hourly consulting engagement with defined scope, deliverables, fee cap, and limitation of liability. |
| [Employment Offer Letter](https://prelegal-blue.vercel.app/templates/employment-offer-letter) | employment | At-will employment offer covering position, start date, salary, and benefits. |
| [Intellectual Property Assignment Agreement](https://prelegal-blue.vercel.app/templates/ip-assignment-agreement) | intellectual property | Transfers ownership of specified intellectual property from an assignor to an assignee. |
| [Promissory Note](https://prelegal-blue.vercel.app/templates/promissory-note) | finance | Borrower's written promise to repay a loan with fixed interest on a defined schedule. |
| [General Release of Claims](https://prelegal-blue.vercel.app/templates/general-release) | disputes | Settles a dispute by releasing claims in exchange for a payment. |

> ⚠️ The templates are general-purpose starting points, **not legal advice**. Have a qualified attorney review a document before real use.

## Screenshots

Captured from the live site (<https://prelegal-blue.vercel.app>) on November 23, 2026, so the frontend stays documented even if the deployment goes offline. All names, companies and addresses are fictional.

**Home: every template in the catalog**

![Home page listing all templates](docs/screenshots/01-home.png)

**Empty form: fields still to complete are highlighted in the live preview, and downloads stay disabled**

![Mutual NDA with an empty form](docs/screenshots/02-mutual-nda-empty.png)

**Filled form: the agreement updates as you type**

![Mutual NDA filled in with fictional data](docs/screenshots/03-mutual-nda-filled.png)

**Any template works the same way, e.g. a Promissory Note**

![Promissory Note filled in with fictional data](docs/screenshots/04-promissory-note-filled.png)

| Mobile | PDF output (print view) |
| --- | --- |
| ![Mobile layout](docs/screenshots/05-mobile.png) | ![Print view used for the PDF download](docs/screenshots/06-pdf-print-view.png) |

Sample output: [`sample-mutual-nda.pdf`](docs/screenshots/sample-mutual-nda.pdf), the completed Mutual NDA from the screenshots above, as produced by **Download PDF**.

## Project structure

| Path | Description |
| --- | --- |
| [`docs/screenshots`](docs/screenshots) | Screenshots of the live site and a sample PDF |
| [`data/templates`](data/templates) | Dataset of legal document templates and their field catalog |
| [`frontend`](frontend) | Next.js app: document creator for every catalog template. See [frontend/README.md](frontend/README.md) |
| [`scripts`](scripts) | Tooling, e.g. `validate-templates.mjs` |

## Deployment

The frontend is deployed on [Vercel](https://vercel.com) as the project **`prelegal`**: <https://prelegal-blue.vercel.app>

Project settings (already configured):

| Setting | Value | Why |
| --- | --- | --- |
| Root Directory | `frontend` | The Next.js app lives there |
| Include source files outside of the Root Directory | Enabled | The app reads `data/templates` at build time |
| Framework Preset | Next.js | |
| Node.js Version | 24.x | Next.js 16 and Vitest 5 need Node 22+ |

To deploy from a local checkout (run from the **repository root**, not `frontend/`, so `data/templates` is uploaded too):

```sh
npx vercel login                       # once
npx vercel link --yes --project prelegal  # once; writes .vercel/ (git-ignored)
npx vercel deploy                      # preview deployment
npx vercel deploy --prod               # production deployment
```

Every page is prerendered at build time, so the deployment is fully static.

> **Automatic deploys from GitHub** are not connected yet. To enable them, add GitHub as a login connection in Vercel (Account Settings → Authentication), then run `npx vercel git connect --project prelegal` and `npx vercel project update prelegal --git-branch main`. After that, pushes to `main` deploy to production and pull requests get preview URLs.
