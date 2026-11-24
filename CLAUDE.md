# Prelegal Project

## Overview

This is a SaaS product to allow users to draft legal agreements based on templates in the templates directory.
The user can carry out AI chat in order to establish what document they want and how to fill in the fields.
The available documents are covered in the catalog.json file in the project root, included here:

@catalog.json

The current implementation is the V1 technical foundation (PL-6): a form-based creator for the templates in `data/templates/catalog.json` (Next.js static export) served by a FastAPI backend with a temporary SQLite database, packaged in Docker, behind a fake sign-in. There is no AI chat or real authentication yet — see Implementation Status below.

Note: the root `catalog.json` lists the CommonPaper templates (e.g. `Mutual-NDA.md`), but those files are not in the repo yet. The prototype uses its own dataset in `data/templates/` (8 templates with its own `catalog.json` and `catalog.schema.json`).

## Development process

When instructed to build a feature:
1. Use your Atlassian tools to read the feature instructions from Jira
2. Develop the feature - do not skip any step from the feature-dev 7 step process
3. Thoroughly test the feature with unit tests and integration tests and fix any issues
4. Submit a PR using your github tools

## AI Design — OpenAI Integration

When writing code to make calls to LLMs, use your Cerebras skill (LiteLLM + Pydantic) and point it at the OpenAI API directly. You should use Structured Outputs so that you can interpret the results and populate fields in the legal document.

- Provider: OpenAI, called directly through LiteLLM. Do not use OpenRouter.
- Model: read from the `OPENAI_MODEL` environment variable, defaulting to `gpt-4.1-mini`. Pass it to LiteLLM as `openai/<model>`.
- Credentials: LiteLLM reads `OPENAI_API_KEY` from the environment (loaded from `.env`). Never hardcode API keys, log them, or expose them in frontend code.
- All LLM requests must be made from the FastAPI backend.
- The uv project must include `litellm` and `pydantic` (`uv add litellm pydantic`).
- Follow the skill's code snippets.
- Preserve the application's existing AI workflows, document generation functionality, and structured response contracts.
- Implement appropriate error handling, timeouts, and retry policies.

## Environment Variables

Both variables are defined in the `.env` file in the project root. Example (placeholder values only):

```bash
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4.1-mini
```

## Technical design

The entire project should be packaged into a Docker container.  
The backend should be in backend/ and be a uv project, using FastAPI.  
The frontend should be in frontend/  
The database should use SQLLite and be created from scratch each time the Docker container is brought up, allowing for a users table with sign up and sign in.  
Consider statically building the frontend and serving it via FastAPI, if that will work.  
There should be scripts in scripts/ for:  
```bash
# Mac
scripts/start-mac.sh    # Start
scripts/stop-mac.sh     # Stop

# Linux
scripts/start-linux.sh
scripts/stop-linux.sh

# Windows
scripts/start-windows.ps1
scripts/stop-windows.ps1
```
Backend available at http://localhost:8000

## Color Scheme
- Accent Yellow: `#ecad0a`
- Blue Primary: `#209dd7`
- Purple Secondary: `#753991` (submit buttons)
- Dark Navy: `#032147` (headings)
- Gray Text: `#888888`

## Implementation Status

Ticket numbers match the PL project in Jira.

### Completed (PL-2) — Dataset of legal document templates
- `data/templates/`: 8 Markdown templates with `{{placeholder}}` fields, described in `catalog.json` and validated against `catalog.schema.json`
- `scripts/validate-templates.mjs` checks the catalog against the template files

### Completed (PL-3) — Prototype of Mutual NDA creator
- Next.js frontend in `frontend/` with a form, live Markdown preview and download

### Completed (PL-4) — Document creator for all catalog templates
- Home page lists all templates; `/templates/[id]` is a statically generated creator page per template
- Form fields grouped per party (from `<party>_*` field naming) plus agreement details
- User input is Markdown/HTML-escaped; multi-line values keep their line breaks
- PDF / Markdown download once all fields are complete and valid
- Vitest unit tests in `frontend/src/lib/fill-template.test.ts`

### Completed (PL-5) — Deploy the frontend to Vercel
- Live at https://prelegal-blue.vercel.app (Vercel project `prelegal`, root directory `frontend`)

### Completed (PL-6) — Build foundation of V1 product
- Docker multi-stage build: `node:24` builds the Next.js static export (`output: "export"`, `trailingSlash: true`; `data/` copied next to `frontend/`), `python:3.13-slim` + uv runs FastAPI as a non-root user with a healthcheck
- Backend `backend/` (uv project, no packaging): `app/main.py` (`create_app` factory, run with `uvicorn app.main:create_app --factory`), `config.py` (pydantic-settings, `PRELEGAL_DB_PATH`, `PRELEGAL_STATIC_DIR`), `db.py` (stdlib sqlite3, no ORM), `schemas.py`, `api.py`
- SQLite deleted and recreated on every app start (`users` table, email unique case-insensitive)
- Static export mounted at `/` after the API; unknown pages get `404.html`, unknown `/api/*` paths get a JSON 404; API docs at `/api/docs`
- Fake sign-in: `/login/` (name + email, no password) → `POST /api/session` upserts the user; the frontend keeps the user in `localStorage` (`useSession` via `useSyncExternalStore`); app pages are in the `(app)` route group behind client-side `RequireSession`; header shows the user and Sign out. Without a backend (Vercel, `npm run dev`) sign-in is device-only
- Palette applied as Tailwind tokens `brand-yellow`, `brand-blue`, `brand-purple`, `brand-navy`, `brand-gray`
- Start/stop scripts: `start-unix.sh`/`stop-unix.sh` hold the logic, mac/linux scripts wrap them; Windows `.ps1`; `PRELEGAL_PORT` overrides port 8000
- Tests: pytest (`cd backend && uv run pytest`) for API, DB reset and static serving; Vitest for `api-client.ts` and `session.ts`

### To do (PL-7) — Add AI Chat but still just Mutual NDA
- Replace the series of questions with a freeform AI chat (see AI Design)
- The AI asks about the document and its fields, and populates the document from the answers
- Mutual NDA only

### To do (PL-8) — Expand to all supported legal document types

### To do (PL-9) — Support multiple users & final polish
- Real sign up / sign in (users table) and per-user documents

### To do (PL-1) — Simple website describing the PreLegal company

### API Endpoints
- `GET /api/health` - Health check
- `POST /api/session` - Fake sign-in: upserts `{name, email}` into `users` and returns `{id, name, email}` (no authentication)
- `GET /api/docs`, `GET /api/openapi.json` - API docs
