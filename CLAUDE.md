# Prelegal Project

## Overview

This is a SaaS product to allow users to draft legal agreements based on templates.
The goal is for the user to carry out AI chat in order to establish what document they want and how to fill in the fields (AI chat starts with PL-7; today the fields are filled in with a form).
The target document set is the CommonPaper catalog in the root `catalog.json`, included here:

@catalog.json

The current implementation is the V1 technical foundation (PL-6): a form-based creator for the templates in `data/templates/catalog.json` (Next.js static export) served by a FastAPI backend with a temporary SQLite database, packaged in Docker, behind a fake sign-in. There is no AI chat or real authentication yet — see Implementation Status below.

Note: the CommonPaper template files listed in the root `catalog.json` (e.g. `Mutual-NDA.md`) are not in the repo yet. The app uses its own dataset in `data/templates/` (8 templates with its own `catalog.json` and `catalog.schema.json`); the frontend reads it at build time.

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
- The uv project must include `litellm` and `pydantic` (`uv add litellm pydantic`). Not added yet: `pydantic` currently comes in through FastAPI and `pydantic-settings`; add both explicitly with the first LLM feature (PL-7).
- Follow the skill's code snippets.
- Preserve the application's existing AI workflows, document generation functionality, and structured response contracts.
- Implement appropriate error handling, timeouts, and retry policies.

## Environment Variables

Both variables are defined in the `.env` file in the project root. Example (placeholder values only):

```bash
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4.1-mini
```

The start scripts pass `.env` to the container at run time (`--env-file`); it is excluded from the Docker build context and never baked into the image. Nothing reads the OpenAI variables yet (PL-7).

Optional backend/script variables (defaults are fine for Docker):
- `PRELEGAL_PORT` - host port used by the start scripts (default `8000`)
- `PRELEGAL_DB_PATH` - SQLite file (default `prelegal.db`; `/tmp/prelegal.db` in the container)
- `PRELEGAL_STATIC_DIR` - frontend export served at `/` (unset = API only; `/app/static` in the container)

## Technical design

The entire project should be packaged into a Docker container.  
The backend should be in backend/ and be a uv project, using FastAPI.  
The frontend should be in frontend/  
The database should use SQLite and be created from scratch each time the Docker container is brought up, allowing for a users table with sign up and sign in (the `users` table exists; sign-in is a fake name + email screen until PL-9).  
The frontend is statically built (Next.js `output: "export"`) and served by FastAPI.  
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
Backend available at http://localhost:8000 (set `PRELEGAL_PORT` if 8000 is taken).

## Color Scheme
Defined as Tailwind tokens in `frontend/src/app/globals.css`:
- Accent Yellow: `#ecad0a` (`brand-yellow`)
- Blue Primary: `#209dd7` (`brand-blue`)
- Purple Secondary: `#753991` (`brand-purple`, submit buttons)
- Dark Navy: `#032147` (`brand-navy`, headings)
- Gray Text: `#888888` (`brand-gray`; ~3.5:1 on white, so not for small body text)

## Implementation Status

Ticket numbers match the PL project in Jira.

### Completed (PL-2) — Dataset of legal document templates
- `data/templates/`: 8 Markdown templates with `{{placeholder}}` fields, described in `catalog.json` and validated against `catalog.schema.json`
- `scripts/validate-templates.mjs` checks the catalog against the template files

### Completed (PL-3) — Prototype of Mutual NDA creator
- Next.js frontend in `frontend/` with a form, live Markdown preview and download

### Completed (PL-4) — Document creator for all catalog templates
- Home page lists all templates; `/templates/<id>/` is a statically generated creator page per template (now under `frontend/src/app/(app)/`)
- Form fields grouped per party (from `<party>_*` field naming) plus agreement details
- User input is Markdown/HTML-escaped; multi-line values keep their line breaks
- PDF / Markdown download once all fields are complete and valid
- Vitest unit tests in `frontend/src/lib/fill-template.test.ts`

### Completed (PL-5) — Deploy the frontend to Vercel
- Live at https://prelegal-blue.vercel.app (Vercel project `prelegal`, root directory `frontend`, CLI deploys only, GitHub not connected)
- Not redeployed since PL-6 merged (as far as recorded); a redeploy would serve the static export with no backend, so sign-in there is device-only

### Completed (PL-6) — Build foundation of V1 product
- Docker multi-stage build: `node:24` builds the Next.js static export (`output: "export"`, `trailingSlash: true`; `data/` copied next to `frontend/`), `python:3.13-slim` + uv runs FastAPI as a non-root user with a healthcheck
- Backend `backend/` (uv project, no packaging): `app/main.py` (`create_app` factory, run with `uvicorn app.main:create_app --factory`), `config.py` (pydantic-settings, `PRELEGAL_DB_PATH`, `PRELEGAL_STATIC_DIR`), `db.py` (stdlib sqlite3, no ORM), `schemas.py`, `api.py`
- SQLite deleted and recreated on every app start (`users` table, email unique case-insensitive); connections use `check_same_thread=False` because FastAPI runs a sync dependency's setup and teardown on different threads
- Static export mounted at `/` after the API; unknown pages get `404.html`, unknown `/api/*` paths get a JSON 404; API docs at `/api/docs`
- Fake sign-in: `/login/` (name + email, no password) → `POST /api/session` upserts the user; the frontend keeps the user in `localStorage` (`useSession` via `useSyncExternalStore`); app pages are in the `(app)` route group behind client-side `RequireSession`; header shows the user and Sign out. Without a backend (Vercel, `npm run dev`) sign-in is device-only
- Palette applied as Tailwind tokens `brand-yellow`, `brand-blue`, `brand-purple`, `brand-navy`, `brand-gray`
- Start/stop scripts: `start-unix.sh`/`stop-unix.sh` hold the logic, mac/linux scripts wrap them; Windows `.ps1`; `PRELEGAL_PORT` overrides port 8000
- Tests: pytest (`cd backend && uv run pytest`, 30 tests) for API, DB reset, concurrent sign-ins and static serving; Vitest (`cd frontend && npm test`, 53 tests) for `fill-template.ts`, `api-client.ts` and `session.ts`

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

## Latest update (2026-11-24)

- **PL-6 done**: merged to `main` via PR #9 (`bae9788`), Jira moved to Listo. Branch `feature/PL-6-v1-foundation` kept.
- **Verified**:
  - all tests, lint, type-check and builds pass
  - the Docker image builds and runs healthy as a non-root user, and the DB resets on restart
  - browser end-to-end runs pass with and without the backend
  - the Windows start/stop scripts were run for real
- **Not verified**:
  - the mac/linux scripts on a real machine (only `bash -n`)
  - a Vercel redeploy of the static export
- **Known quirks**:
  - Locally, port 8000 is often taken by another container (`pm-mvp-api`); use `PRELEGAL_PORT=8001`.
  - pytest prints a Starlette deprecation warning about `httpx`; the fix is to switch the dev dependency to `httpx2`.
- **Next**: PL-7 (AI chat for the Mutual NDA) — add `litellm`/`pydantic`, follow AI Design above, keep all LLM calls in the backend.
