# Prelegal Project

## Overview

This is a SaaS product to allow users to draft legal agreements based on templates.
The user can carry out AI chat in order to establish what document they want and how to fill in the fields. Today the AI chat fills in the Mutual NDA (PL-7); the other templates use a form, and choosing the document type by chat comes with PL-8.
The target document set is the CommonPaper catalog in the root `catalog.json`, included here:

@catalog.json

The current implementation is the V1 technical foundation (PL-6) plus AI chat for the Mutual NDA (PL-7): a creator for the templates in `data/templates/catalog.json` (Next.js static export) served by a FastAPI backend with a temporary SQLite database, packaged in Docker, behind a fake sign-in. The Mutual NDA is filled in by chatting with an AI assistant (OpenAI via LiteLLM); the other templates use a form. There is no real authentication yet — see Implementation Status below.

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
- The uv project must include `litellm` and `pydantic` (`uv add litellm pydantic`). Both are added (PL-7); `backend/app/llm.py` is the only module that imports litellm.
- Follow the skill's code snippets.
- Preserve the application's existing AI workflows, document generation functionality, and structured response contracts.
- Implement appropriate error handling, timeouts, and retry policies.

## Environment Variables

Both variables are defined in the `.env` file in the project root. Example (placeholder values only):

```bash
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4.1-mini
```

The start scripts pass `.env` to the container at run time (`--env-file`); it is excluded from the Docker build context and never baked into the image. `backend/app/llm.py` reads `OPENAI_MODEL` at call time; LiteLLM reads `OPENAI_API_KEY`. Without a key the chat returns `llm_not_configured` and the UI offers the form. For a local backend outside Docker, load the file with `uv run --env-file ../.env ...`.

Optional backend/script variables (defaults are fine for Docker):
- `PRELEGAL_PORT` - host port used by the start scripts (default `8000`)
- `PRELEGAL_DB_PATH` - SQLite file (default `prelegal.db`; `/tmp/prelegal.db` in the container)
- `PRELEGAL_STATIC_DIR` - frontend export served at `/` (unset = API only; `/app/static` in the container)
- `PRELEGAL_TEMPLATES_DIR` - template catalog the chat builds its prompt and schema from (default: repo `data/templates`; `/app/data/templates` in the container)
- `PRELEGAL_LLM_TIMEOUT_S`, `PRELEGAL_LLM_MAX_RETRIES` - per-attempt timeout (default `20`) and OpenAI client retries (default `1`)
- `LITELLM_LOCAL_MODEL_COST_MAP` - `True` (set in `llm.py` and the image) so LiteLLM doesn't fetch its model map at import

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

### Completed (PL-7) — Add AI Chat but still just Mutual NDA
- **Endpoint:** `POST /api/chat` is stateless. The client sends `{template_id, messages, values}` and gets `{reply, values, complete}`.
  - Only `mutual-nda` is supported (`CHAT_TEMPLATE_IDS` in `backend/app/chat.py` and `frontend/src/lib/chat.ts`).
- **Backend modules:**
  - `templates.py` loads `catalog.json`.
  - `llm.py` holds `LiteLlmClient`: `completion(model=openai/<OPENAI_MODEL>, response_format=<Pydantic>, timeout, max_retries)`, then `model_validate_json`.
    - It maps refusals, truncation and schema mismatches to `LlmError`.
    - It maps provider errors to HTTP status + `{"detail": {code, message, retryable}}`: 504 timeout, 429 rate limit, 503 not configured, 422 rejected, 502 unavailable / bad response.
    - It logs only exception class names. LiteLLM message logging is off.
  - `chat.py` holds the chat logic:
    - the strict structured-output schema, built per template with `create_model`: one `str | None` slot per field (`null` = not given), with `pattern`s for dates and integers;
    - the system prompt, which includes today's date and the current values as JSON data;
    - `normalise_value`, which validates per type and mirrors `isFilled`, and drops unknown keys;
    - the merge of extracted values, and `complete`.
- **Tests:** `create_app(settings, llm=...)` takes an injectable LLM; tests use a `FakeLlm` and never call OpenAI.
- **Frontend:**
  - `lib/chat.ts`: the client, plus `sessionStorage` persistence per user and template.
  - `ChatPanel.tsx`: Start over, Retry, and "Use the form instead".
  - `FormEditor.tsx`: the form, extracted from `DocumentBuilder`.
  - `DocumentBuilder.tsx`: probes `/api/health` once and falls back to the form when there is no backend.
  - `apiRequest`: treats a coded error envelope as an `ApiError` for any status, and has an `AbortSignal.any` fallback for older browsers.
- **Docker:** the runtime image copies `data/templates`. The image is about 1.1 GB, mostly LiteLLM.
- **Tests:** pytest 103 (chat schema and strict-mode compatibility, normalisation, prompt, LLM error mapping, `/api/chat`); Vitest 89 (`chat.ts`, `api-client.ts`).
- **Verified:** a browser end-to-end run with real OpenAI completes the NDA in two messages.

### To do (PL-8) — Expand to all supported legal document types

### To do (PL-9) — Support multiple users & final polish
- Real sign up / sign in (users table) and per-user documents

### To do (PL-1) — Simple website describing the PreLegal company

### API Endpoints
- `GET /api/health` - Health check
- `POST /api/session` - Fake sign-in: upserts `{name, email}` into `users` and returns `{id, name, email}` (no authentication)
- `POST /api/chat` - One AI chat turn (Mutual NDA only): `{template_id, messages, values}` → `{reply, values, complete}`; errors `{"detail": {code, message, retryable}}` (no auth or rate limit until PL-9)
- `GET /api/docs`, `GET /api/openapi.json` - API docs

## Latest update (2026-11-24)

- **PL-6 done**: merged in PR #9 (`bae9788`); Jira status Listo.
- **PL-7 implemented** on `feature/PL-7-ai-chat-mutual-nda`: AI chat for the Mutual NDA (see Completed (PL-7)). This branch includes the CLAUDE.md update from PR #10.
- **Verified for PL-7**:
  - backend and frontend tests, lint, type-check and builds pass;
  - the Docker image runs healthy as a non-root user;
  - real OpenAI calls (gpt-4.1-mini) in a browser end-to-end run: the NDA completes in two messages, and reload, Start over, per-user storage and the other templates' form all work;
  - the no-backend fallback to the form;
  - a bad API key returns `llm_not_configured`, and the key never appears in the logs.
- **Not verified**:
  - the mac/linux scripts on a real machine;
  - a Vercel redeploy of the static export.
- **Known quirks**:
  - Locally, port 8000 is often taken by another container (`pm-mvp-api`); use `PRELEGAL_PORT=8001`.
  - pytest prints a Starlette deprecation warning about `httpx`; the fix is to switch the dev dependency to `httpx2`.
  - `/api/chat` is unauthenticated (PL-9).
- **Next**: PL-8 (all document types via chat). Add a per-template chat flag or open `CHAT_TEMPLATE_IDS`, and let the AI choose the template.
