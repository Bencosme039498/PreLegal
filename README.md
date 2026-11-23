# PreLegal
A platform for drafting common legal agreements

**🌐 Live site: <https://prelegal-blue.vercel.app>**: pick a template (e.g. the [Mutual NDA](https://prelegal-blue.vercel.app/templates/mutual-nda)), fill in the details, and download the agreement as PDF or Markdown.

> 🚧 **Status: In progress.** This project is under active development and is expected to be completed within 1 week (target: November 28, 2026).

## Project structure

| Path | Description |
| --- | --- |
| [`data/templates`](data/templates) | Dataset of legal document templates and their field catalog |
| [`frontend`](frontend) | Next.js app: the Mutual NDA creator prototype. See [frontend/README.md](frontend/README.md) |
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
