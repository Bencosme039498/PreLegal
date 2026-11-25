# PreLegal
A platform for drafting common legal agreements

**🌐 Live site: <https://prelegal-blue.vercel.app>**

PreLegal is a generic document creator: pick any template, fill it in, watch the agreement update live, and download the completed document as PDF or Markdown. Tell the **AI drafting assistant** what you need: it picks the right document (or explains it can't generate it and offers the closest one), then fills it in as you answer. The form is still there as a fallback. The forms and documents come straight from the template dataset in [`data/templates`](data/templates), so adding a template to the catalog adds it to the site.

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

Captured on November 23–24, 2026, so the frontend stays documented even if the deployment goes offline. All names, companies and addresses are fictional. The home page shows the AI chat (PL-8, running with the backend); the other screenshots were taken from the static Vercel site, where there is no backend, so they show the form that the chat replaces when a backend is available.

**Home: ask the drafting assistant, or pick any template in the catalog**

![Home page with the AI chat above the list of templates](docs/screenshots/01-home.png)

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

## Run locally with Docker

The whole app (frontend + backend + a throwaway database) runs in one Docker container at **<http://localhost:8000>**. Requires [Docker](https://www.docker.com/) to be running.

| OS | Start | Stop |
| --- | --- | --- |
| macOS | `scripts/start-mac.sh` | `scripts/stop-mac.sh` |
| Linux | `scripts/start-linux.sh` | `scripts/stop-linux.sh` |
| Windows (PowerShell) | `scripts\start-windows.ps1` | `scripts\stop-windows.ps1` |

The start script builds the image, (re)starts the `prelegal` container and waits until it is healthy. On macOS/Linux run the scripts with `bash scripts/start-mac.sh` if they are not executable. If port 8000 is taken, set `PRELEGAL_PORT` (e.g. `PRELEGAL_PORT=8001 scripts/start-linux.sh`, or `$env:PRELEGAL_PORT = 8001` in PowerShell).

- **Accounts** (PL-9): create an account (name, email, password) at `/signup/`, then sign in at `/login/`. Passwords are hashed with scrypt; the session lives in an HttpOnly cookie for 14 days. Repeated failed sign-ins are slowed down.
- **My documents**: every draft is saved to your account as you chat or type (Draft / Complete). Reopen one from `/documents/` or the dashboard to keep editing or download it again, or delete it. Downloads (PDF and Markdown) carry a notice that the document is a draft subject to legal review.
- **The local database is throwaway**: the start scripts set `PRELEGAL_DB_RESET=true`, so the SQLite file inside the container is recreated empty every time the container starts, and accounts, sessions and documents are wiped on restart (you'll be asked to sign up again). Production keeps its database (see [Database reset policy](#database-reset-policy)).
- A `.env` file in the repository root, if present, is passed to the container at run time (it is never copied into the image). The AI chat needs `OPENAI_API_KEY` there; `OPENAI_MODEL` is optional (default `gpt-4.1-mini`). Without a key the app still runs: the chat reports it isn't configured, and offers the form on a document page (on the home page, the list of documents below it).
- **AI chat (every template)**: on the home page, describe what you need and the assistant picks the document. If you ask for something PreLegal can't generate (e.g. a lease), it says so and offers the closest document, or lists what it can draft. It then opens the document's page with the conversation so far and keeps asking for what's missing. Mid-conversation you can ask for a different document: once you confirm, it switches and carries over the details that still apply (dates, governing law…). The backend calls OpenAI through LiteLLM with Structured Outputs; every value the AI extracts is validated on the server before it reaches the document. `/api/chat` needs a signed-in user and is rate limited per user (30 turns a minute by default). If the backend isn't reachable (e.g. a static-only deployment, or `npm run dev`), there are no accounts: a labelled demo sign-in opens the form-based editor, and nothing is saved.

### Architecture

```
Docker image
├── build stage (node:24)    frontend/ + data/  ──npm run build──▶  static export (out/)
└── runtime (python:3.13)    FastAPI (backend/) on :8000, data/templates (chat prompt + schema)
                               ├── /api/*   JSON API, SQLite (PRELEGAL_DB_PATH), AI chat ──LiteLLM──▶ OpenAI
                               └── /*       the static export (404.html for unknown pages)
```

In production the same image runs on Render, behind the Vercel site (see [Deployment](#deployment)).

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Health check |
| `POST /api/auth/signup` | Create an account `{name, email, password}` and sign in (sets the session cookie); 409 `email_taken` |
| `POST /api/auth/login` | Sign in `{email, password}`; 401 `invalid_credentials`, 429 `too_many_attempts` |
| `POST /api/auth/logout` | Sign out (ends the session, clears the cookie) |
| `GET /api/auth/me` | The signed-in user, or 401 `not_authenticated` |
| `GET, POST /api/documents` | The user's saved documents (newest first) / save a new draft `{template_id, title, values, messages}` |
| `GET, PUT, DELETE /api/documents/{id}` | Open, replace (autosave) or delete one of the user's documents; another user's id is a 404 |
| `POST /api/chat` | One AI chat turn (signed in; rate limited per user): `{template_id?, messages, values}` → `{reply, template_id, values, complete}`. Without `template_id` the AI picks the document; a response `template_id` that differs from the request's means the AI chose or switched documents |
| `GET /api/docs` | Interactive API docs |

Errors return `{"detail": {"code", "message", "retryable"}}`. Optional settings (`PRELEGAL_*` environment variables): `SESSION_TTL_S` (default 14 days), `COOKIE_SECURE` (set `true` when serving over HTTPS), `CHAT_RATE_LIMIT` / `CHAT_RATE_WINDOW_S` (30 per 60 s), `AUTH_RATE_LIMIT` / `AUTH_RATE_WINDOW_S` (10 failed sign-ins or sign-ups per 300 s), `MAX_DOCUMENTS_PER_USER` (200).

### Development

```sh
# Backend (http://localhost:8000): API only unless PRELEGAL_STATIC_DIR points at a frontend build
cd backend
uv sync
uv run pytest                     # tests, no network (includes serving frontend/out if it has been built)
uv run ruff check . && uv run ruff format --check .
PRELEGAL_STATIC_DIR=../frontend/out uv run --env-file ../.env uvicorn app.main:create_app --factory --reload

# Frontend (see frontend/README.md)
cd frontend
npm install
npm run dev                       # http://localhost:3000, no backend: device-only sign-in, form instead of chat
npm test && npm run lint && npm run build
```

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | none | OpenAI key for the AI chat (root `.env`; read by LiteLLM, never logged or sent to the browser) |
| `OPENAI_MODEL` | `gpt-4.1-mini` | OpenAI model, called as `openai/<model>` |
| `PRELEGAL_PORT` | `8000` | Host port used by the start scripts |
| `PRELEGAL_DB_PATH` | `prelegal.db` (`/tmp/prelegal.db` in the image) | SQLite database file (`/var/data/prelegal.db`, on the persistent disk, in production) |
| `PRELEGAL_DB_RESET` | `false` (`true` in the start scripts) | `true` deletes and recreates the database on every start. Local development and tests only, never in production |
| `PRELEGAL_STATIC_DIR` | unset (`/app/static` in the image) | Frontend export served at `/`; unset serves the API only |
| `PRELEGAL_TEMPLATES_DIR` | repo `data/templates` (`/app/data/templates` in the image) | Template catalog the chat builds its prompt and schema from |
| `PRELEGAL_LLM_TIMEOUT_S` / `PRELEGAL_LLM_MAX_RETRIES` | `20` / `1` | Per-attempt timeout and retries for OpenAI calls |
| `PRELEGAL_CHAT_BUDGET_S` | `50` | Total time for one chat request, which may make two OpenAI calls (choosing a document, then its first turn). Must stay below the frontend's 60 s timeout (enforced) |
| `LITELLM_LOCAL_MODEL_COST_MAP` | `True` | Use LiteLLM's bundled model map instead of fetching it at startup |
| `PORT` / `FORWARDED_ALLOW_IPS` | `8000` / uvicorn's `127.0.0.1` | Production only (set in `render.yaml`): the port Render routes to, and trusting `X-Forwarded-For` so rate limits see each visitor's address |

The Docker image is about 1.1 GB, mostly LiteLLM and its dependencies.

## Project structure

| Path | Description |
| --- | --- |
| [`backend`](backend) | FastAPI app (uv project): the API, the SQLite database, and serving the frontend build; `entrypoint.sh` for the container |
| [`docs/screenshots`](docs/screenshots) | Screenshots of the app and a sample PDF |
| [`data/templates`](data/templates) | Dataset of legal document templates and their field catalog |
| [`frontend`](frontend) | Next.js app (static export): sign-in, the AI chat (home page and every template) with the form as fallback. See [frontend/README.md](frontend/README.md) |
| [`scripts`](scripts) | Start/stop scripts for macOS, Linux and Windows, and `validate-templates.mjs` |
| [`Dockerfile`](Dockerfile) | Multi-stage build of the whole app (used locally and on Render) |
| [`render.yaml`](render.yaml) | Render Blueprint for the production backend |
| [`frontend/vercel.json`](frontend/vercel.json) | Vercel rewrite of `/api/*` to the Render backend |
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | Tests on every pull request and push to `main` (Render deploys only after they pass) |


## Deployment

Production is two services. Visitors only ever see the Vercel URL:

```
browser ──HTTPS──▶ Vercel  https://prelegal-blue.vercel.app      (project "prelegal", static export)
                     ├── /*       the static frontend
                     └── /api/*   rewrite (frontend/vercel.json) ──HTTPS──▶ Render  prelegal-api
                                                                             FastAPI (this Dockerfile)
                                                                             SQLite on a 1 GB disk at /var/data
                                                                             OPENAI_API_KEY ──▶ OpenAI
```

- **Same origin for the browser.** The rewrite proxies `/api/*` on the Vercel domain, so the HttpOnly `SameSite=Lax` session cookie is a first-party cookie and there is no CORS. The frontend needs no API URL or environment variable.
- **Secrets only on Render.** `OPENAI_API_KEY` is set in the Render dashboard and nowhere else. The Vercel project needs no environment variables at all: its build is a static export and never reads one.
- **Persistent database.** SQLite lives on a Render persistent disk, so accounts, sessions, conversations and documents survive restarts and deploys. Render snapshots the disk every 24 hours and keeps snapshots for 7 days.
- **Automatic deploys from GitHub.** Pull requests and pushes to `main` run [CI](.github/workflows/ci.yml). Render deploys `main` once those checks pass (`autoDeployTrigger: checksPass`). Vercel deploys `main` to production and gives pull requests preview URLs (once its Git connection is set up, below). Preview deployments also rewrite to the production backend, so they use production accounts.
- **Behind proxies.** API responses carry `Cache-Control: no-store`, so Vercel never caches them. `/api/x/` is accepted as `/api/x`, because the export's `trailingSlash: true` can make Vercel redirect before proxying. uvicorn takes the visitor's address from `X-Forwarded-For` (`FORWARDED_ALLOW_IPS=*`), which Vercel sets, for the per-address rate limits.

### Costs

| Service | Plan | Monthly cost |
| --- | --- | --- |
| Render workspace | Hobby | $0 |
| Render web service | `0.5c-512mb` instance (0.5 CPU, 512 MB; the container uses about 200 MB) | $7 |
| Render persistent disk | 1 GB SSD ($0.25 per GB) | $0.25 |
| Vercel | Hobby | $0 |
| GitHub Actions | Free minutes | $0 |
| OpenAI | `gpt-4.1-mini`, pay per token | usage only |

That's **about $7.25 a month** plus OpenAI usage (prices as published by Render in November 2026). Render's free instance is not an option: it can't have a disk, and it sleeps after 15 minutes idle and takes about a minute to wake, longer than the frontend waits before falling back to demo mode.

### Database reset policy

| Where | `PRELEGAL_DB_RESET` | Effect |
| --- | --- | --- |
| Production (Render) | `false` | The database at `/var/data/prelegal.db` is created once and then kept |
| Local Docker scripts | `true` | Fresh empty database on every container start |
| Tests | per test | Each test gets its own temporary file; tests cover both modes |
| Not set | `false` | Kept. Resetting is always explicit |

The schema is created with `CREATE TABLE IF NOT EXISTS` and stamped with a version (`PRAGMA user_version`). The app refuses to start on a database from another schema version instead of using tables it doesn't understand, so a future schema change has to ship a migration.

> ⚠️ **Never deploy or roll back the Render service to a commit from before PL-10.** That code deletes the database on every start, and it would wipe production data. To restore data, use a Render disk snapshot.

### First-time setup

**1. Render (backend)**, about 10 minutes, requires the paid instance above:

1. Sign up at [render.com](https://render.com) with GitHub, and give the Render GitHub app access to `Bencosme039498/PreLegal`.
2. **New → Blueprint**, pick the repository and the branch (`main`; or a pull request's branch to try it before merging, then switch the Blueprint to `main` afterwards). Render reads [`render.yaml`](render.yaml).
3. When asked, enter `OPENAI_API_KEY`. Every other variable comes from the Blueprint.
4. Apply. After the first deploy, `https://prelegal-api.onrender.com/api/health` returns `{"status":"ok"}`. If Render gave the service a different URL, put it in [`frontend/vercel.json`](frontend/vercel.json).

**2. Vercel (frontend).** The project settings are already configured:

| Setting | Value | Why |
| --- | --- | --- |
| Root Directory | `frontend` | The Next.js app and `vercel.json` live there |
| Include source files outside of the Root Directory | Enabled | The app reads `data/templates` at build time |
| Framework Preset | Next.js | |
| Node.js Version | 24.x | Next.js 16 and Vitest 5 need Node 22+ |
| Environment Variables | none | Remove any `OPENAI_*` variables: the key belongs on Render only |

To connect automatic deploys, add GitHub as a login connection in Vercel (Account Settings → Authentication), then run `npx vercel git connect --project prelegal` and `npx vercel project update prelegal --git-branch main`. After that, pushes to `main` deploy to production and pull requests get preview URLs.

To deploy by hand instead (from the **repository root**, not `frontend/`, so `data/templates` is uploaded too):

```sh
npx vercel login                          # once
npx vercel link --yes --project prelegal  # once; writes .vercel/ (git-ignored)
npx vercel deploy                         # preview deployment
npx vercel deploy --prod                  # production deployment
```

**3. Check**: on <https://prelegal-blue.vercel.app> the sign-in page no longer says "Demo mode". Sign up, draft a document with the AI chat, then restart the Render service (Manual Deploy → Restart). You should still be signed in, and the document should still be in My documents.

### Operating notes

- A deploy restarts the single instance: the API is unavailable for up to a minute (a disk rules out zero-downtime deploys). Rate limits live in memory and reset then; sessions don't.
- The backend also answers directly at its `onrender.com` URL, which serves the whole app too. Use the Vercel URL. Its session cookie is separate, and direct requests can set their own `X-Forwarded-For`, which weakens only the per-address limits (failed sign-ins are also limited per email).
- One instance only: SQLite on a disk can't be shared. Scaling out would mean moving to Postgres.
