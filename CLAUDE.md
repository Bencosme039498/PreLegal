# Prelegal Project

## Overview

This is a SaaS product to allow users to draft legal agreements based on templates.
The user can carry out AI chat in order to establish what document they want and how to fill in the fields. The home page chat picks the document, or explains it can't be generated and offers the closest one. Each template page's chat fills that document in and can switch to another one (PL-7, PL-8). The form is the fallback.
The target document set is the CommonPaper catalog in the root `catalog.json`, included here:

@catalog.json

The current implementation is the V1 technical foundation (PL-6), AI chat for every template (PL-7, PL-8), and accounts with saved documents (PL-9): a creator for the 8 templates in `data/templates/catalog.json` (Next.js static export) served by a FastAPI backend, packaged in Docker, with SQLite locally and PostgreSQL in production. In production (PL-10), at zero fixed cost, Vercel Hobby serves the frontend at https://prelegal-blue.vercel.app and rewrites `/api/*` to the same Docker image on Render Free; the data lives in PostgreSQL on Neon Free. The frontend shows a "waking up" state while the free backend starts from sleep. Users sign up and sign in (password, HttpOnly session cookie), and every draft autosaves to their "My documents". Documents are chosen and filled in by chatting with an AI assistant (OpenAI via LiteLLM). Without a backend (static hosting) there are no accounts: a labelled demo sign-in opens the form, and nothing is saved. See Implementation Status below.

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

The start scripts pass `.env` to the container at run time (`--env-file`); it is excluded from the Docker build context and never baked into the image. `backend/app/llm.py` reads `OPENAI_MODEL` at call time; LiteLLM reads `OPENAI_API_KEY`. Without a key the chat returns `llm_not_configured`: a template page offers the form, the home chat points to the list of documents. For a local backend outside Docker, load the file with `uv run --env-file ../.env ...`.

Optional backend/script variables (defaults are fine for Docker):
- `PRELEGAL_PORT` - host port used by the start scripts (default `8000`)
- `DATABASE_URL` (or `PRELEGAL_DATABASE_URL`) - PostgreSQL connection string; set means PostgreSQL (production: Neon's pooled `-pooler` host, `sslmode=require`), unset means SQLite. A `SecretStr`, only in the Render dashboard
- `PRELEGAL_DB_PATH` - SQLite file when `DATABASE_URL` is unset (default `prelegal.db`; `/tmp/prelegal.db` in the container)
- `PRELEGAL_DB_RESET` - `true` deletes and recreates the SQLite database on every start (default `false`). Set only by the local start scripts; rejected together with `DATABASE_URL`
- `PRELEGAL_TEST_DATABASE_URL` - tests only: runs the whole pytest suite on that PostgreSQL database (emptied before each test)
- `PRELEGAL_STATIC_DIR` - frontend export served at `/` (unset = API only; `/app/static` in the container)
- `PRELEGAL_TEMPLATES_DIR` - template catalog the chat builds its prompt and schema from (default: repo `data/templates`; `/app/data/templates` in the container)
- `PRELEGAL_LLM_TIMEOUT_S`, `PRELEGAL_LLM_MAX_RETRIES` - per-attempt timeout (default `20`) and retries after a failed attempt (default `1`; the chat retries itself within its budget, the OpenAI client doesn't)
- `PRELEGAL_CHAT_BUDGET_S` - total time for one `/api/chat` request, which may make two LLM calls (default `50`; must be under 60 s, enforced by validation; the frontend waits 110 s, which also covers LiteLLM still loading after a cold start, below Vercel's 120 s proxy limit)
- `PRELEGAL_SESSION_TTL_S` - how long a sign-in lasts (default 14 days)
- `PRELEGAL_COOKIE_SECURE` - `true` makes the session cookie HTTPS-only; leave it off for the plain-http Docker scripts (put it in `.env` for an HTTPS deployment)
- `PRELEGAL_CHAT_RATE_LIMIT`, `PRELEGAL_CHAT_RATE_WINDOW_S` - AI chat turns per user per window (default `30` per `60` s)
- `PRELEGAL_AUTH_RATE_LIMIT`, `PRELEGAL_AUTH_RATE_WINDOW_S` - failed sign-ins per email and per address, and sign-ups per address, per window (default `10` per `300` s)
- `PRELEGAL_MAX_DOCUMENTS_PER_USER` - saved drafts per user (default `200`)
- `LITELLM_LOCAL_MODEL_COST_MAP` - `True` (set in `llm.py` and the image) so LiteLLM doesn't fetch its model map at import
- Production only (`render.yaml`): `PORT=8000` (the port Render routes to) and `FORWARDED_ALLOW_IPS=*` (uvicorn takes the client address from `X-Forwarded-For`, which Vercel sets, so rate limits see each visitor)

Vercel needs no environment variables: the frontend is a static export and reads none. `OPENAI_API_KEY` and `DATABASE_URL` live only in the Render dashboard (the key also in the local `.env`). OpenAI usage is the only paid service: never activate paid infrastructure (see README "Costs and free-tier limits").

## Technical design

The entire project should be packaged into a Docker container.  
The backend should be in backend/ and be a uv project, using FastAPI.  
The frontend should be in frontend/  
The database is SQLite locally and PostgreSQL in production (PL-10), with a users table for sign up and sign in (done in PL-9: `users`, `sessions` and `documents` tables). Database reset policy (PL-10): production (PostgreSQL) keeps its data across restarts and deploys, and the app can't reset it; the local start scripts (`PRELEGAL_DB_RESET=true`) and tests create a fresh database each time.  
Production (PL-10): free tiers only. The backend image runs on Render Free (`render.yaml`) behind a Vercel rewrite (`frontend/vercel.json`), with PostgreSQL on Neon Free; see README "Deployment".  
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
- Until PL-10 the deployment had no backend, so it showed "Demo mode" (device-only sign-in, the form instead of the chat). PL-10 adds the `/api/*` rewrite to Render

### Completed (PL-6) — Build foundation of V1 product
- Docker multi-stage build: `node:24` builds the Next.js static export (`output: "export"`, `trailingSlash: true`; `data/` copied next to `frontend/`), `python:3.13-slim` + uv runs FastAPI as a non-root user with a healthcheck
- Backend `backend/` (uv project, no packaging): `app/main.py` (`create_app` factory, run with `uvicorn app.main:create_app --factory`), `config.py` (pydantic-settings, `PRELEGAL_DB_PATH`, `PRELEGAL_STATIC_DIR`), `db.py` (stdlib sqlite3, no ORM), `schemas.py`, `api.py`
- SQLite deleted and recreated on every app start (`users` table, email unique case-insensitive); connections use `check_same_thread=False` because FastAPI runs a sync dependency's setup and teardown on different threads
- Static export mounted at `/` after the API; unknown pages get `404.html`, unknown `/api/*` paths get a JSON 404; API docs at `/api/docs`
- Fake sign-in (replaced by real accounts in PL-9): `/login/` (name + email, no password) → `POST /api/session` upserted the user; the frontend keeps the user in `localStorage` (`useSession` via `useSyncExternalStore`); app pages are in the `(app)` route group behind client-side `RequireSession`; header shows the user and Sign out. Without a backend (Vercel, `npm run dev`) sign-in is device-only
- Palette applied as Tailwind tokens `brand-yellow`, `brand-blue`, `brand-purple`, `brand-navy`, `brand-gray`
- Start/stop scripts: `start-unix.sh`/`stop-unix.sh` hold the logic, mac/linux scripts wrap them; Windows `.ps1`; `PRELEGAL_PORT` overrides port 8000
- Tests: pytest (`cd backend && uv run pytest`) for API, DB reset, concurrent sign-ins and static serving; Vitest (`cd frontend && npm test`) for `fill-template.ts`, `api-client.ts` and `session.ts` (30 and 53 tests at PL-6; current totals under PL-8)

### Completed (PL-7) — Add AI Chat but still just Mutual NDA
- **Endpoint:** `POST /api/chat` is stateless. The client sends `{template_id, messages, values}` and gets `{reply, values, complete}`.
  - At PL-7 only `mutual-nda` was supported (a `CHAT_TEMPLATE_IDS` gate, removed in PL-8).
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

### Completed (PL-8) — Expand to all supported legal document types
- **Scope:** all 8 templates in `data/templates`. Importing the CommonPaper templates in the root `catalog.json` would be a separate ticket: their cover pages are DOCX-only, they use HTML spans, and they are up to 45 KB.
- **Endpoint:** `POST /api/chat` takes `{template_id?, messages, values}` and returns `{reply, template_id, values, complete}`.
  - With no `template_id`, the request is a selection turn.
  - A response `template_id` that differs from the request's means the AI chose or switched documents, and the client opens that page.
  - An unknown non-null id returns 404 `unknown_template`.
- **`chat.py`, two kinds of structured-output turn:**
  - **Selection:** `selection_model` with `template_id: Literal[ids] | None`. Unsupported requests get an explanation and the closest document (or the list), and `template_id` stays null until the user agrees.
  - **Drafting:** `turn_model(template, switch_ids)` adds `switch_to: Literal[other ids] | None`, set only after the user confirms.
  - When a document is chosen or switched to, `_enter` runs its first drafting turn in the same request. Defaults are seeded and same-key valid values are carried over; on a switch the previous values go to the model as JSON data so it can map roles. Only one switch per request.
  - If `_enter` fails or less than 8 s is left, the user still lands on the document with a fixed reply.
- **Generic prompt:**
  - party roles come from field prefixes (`party_roles`, mirrors `groupFields`);
  - each field shows where its value lands (`FieldDef.usage`, derived from the template body by `templates.field_usages`, e.g. 'a ___ with its principal address at');
  - format hints for money and percent;
  - select options are an enum in the schema.
- **Normalisation:** select values map case-insensitively to the canonical option, percent becomes `5%`, and money must contain a digit.
- **Time budget:** `Budget` splits `chat_budget_s` (50 s) between calls and attempts. `_ask` retries retryable failures itself (the OpenAI client gets `max_retries=0`), so a provider `Retry-After` can't outlast the client's 60 s.
- **Frontend:**
  - `HomeChat.tsx`: the home chat, hidden without a backend.
  - `ChatPanel`: `templateId: string | null` and `onNavigate`; it stays "Thinking…" until the page changes.
  - `DocumentBuilder`: chat on every template; `openDocument` on a switch saves the AI's answer to the old document too.
  - `lib/chat.ts`: `planHandoff` (pure), `HOME_CHAT` storage target, and `fromHome`, which keeps the home greeting.
  - `useChatAvailability`: the shared `/api/health` probe.
  - The template page renders `<DocumentBuilder key={template.id}>`.
- **Tests:**
  - pytest 186: strict schemas for every template, selection, entering, switching, fallbacks, retries within the budget, normalisation, prompts, usages, config validation.
  - Vitest 94: handoff, storage, home chat client.
- **Verified with real OpenAI (gpt-4.1-mini)** in browser end-to-end runs:
  - "lease" is explained on the home page;
  - a loan request opens the Promissory Note with $5,000 / 4% / the lender filled in;
  - the note is complete after one more message;
  - switching to a General Release asks for confirmation first, then carries over the governing law;
  - the home greeting survives a reload;
  - the PL-7 NDA flow still works;
  - the no-backend fallback works.

### Completed (PL-9) — Support multiple users & final polish
- **Accounts** (`backend/app/auth.py`): `POST /api/auth/signup|login|logout`, `GET /api/auth/me`.
  - Passwords: stdlib `hashlib.scrypt` (`scrypt$n$r$p$salt$hash`). Unknown emails are checked against a dummy hash, and a wrong password or an unknown email both give 401 `invalid_credentials`.
  - Sessions: a random token in the HttpOnly, SameSite=Lax cookie `prelegal_session`; the `sessions` table keeps only its SHA-256 and an expiry. The `CurrentUser` dependency gives 401 `not_authenticated`. A restart wipes the database, so everyone signs in again.
  - Rate limits (`ratelimit.py`: in memory, sliding window, clock injectable via `create_app(..., clock=)`): failed sign-ins per email and per address, sign-ups per address (429 `too_many_attempts` with `Retry-After`), and `/api/chat` turns per user (429 `chat_rate_limited`).
  - `/api/session` is gone; `/api/chat` needs a signed-in user.
- **Saved documents** (`documents.py`, queries in `db.py`): `GET/POST /api/documents`, `GET/PUT/DELETE /api/documents/{id}`.
  - Every query is scoped by `user_id`: another user's id is a 404.
  - Values are stored as typed (unknown keys dropped); `complete` uses the chat's rules; PUT replaces the whole draft (title, values, messages). Ids are bounded to SQLite's integer range.
- **Backend structure**:
  - Shared dependencies are in `deps.py` (`DbConn`, `SettingsDep`, `Catalog`, `Clock`, the limiters, `api_error`).
  - `DbConn` uses `scope="function"`, so the transaction commits **before** the response is sent. With the default "request" scope it committed afterwards, and a request right after sign-in could get a 401.
  - The JSON 404 catch-all is `api.fallback`, included last in `main.py`.
  - `PRAGMA foreign_keys = ON` per connection (cascade on user delete).
- **Frontend**:
  - `lib/session.ts`: `signUp`, `signIn`, `signOut(user)`, `fetchCurrentUser`, `demoUser`, `forgetUser`, and validators mirroring the backend. `localStorage` only caches the user: `RequireSession` checks it with `/api/auth/me`, and `setUnauthenticatedHandler` (`api-client.ts`) signs the tab out on any 401 `not_authenticated`. `apiRequest` returns `undefined` for a 204.
  - `/login/` and `/signup/` share `AuthShell` and `AuthForm`; with no backend they offer the labelled demo sign-in.
  - Autosave: `lib/autosave.ts` (framework-free: debounce, one save at a time, a failed snapshot kept for Retry, `flushAllAutosavers` before sign-out) and `useDocumentAutosave`. The first save creates the document and `history.replaceState`s `?doc=<id>`; unchanged content is never saved.
  - `DocumentLoader` picks the draft: `?doc=<id>` (the tab's copy if it has that id, otherwise fetched), or, without `?doc`, a new draft or an unsaved AI handoff from sessionStorage (`StoredChat.docId` marks a saved one). "New draft" remounts the builder. An AI switch saves the current draft (with the AI's answer) before opening the next.
  - `/documents/` (`DocumentsList`: Draft/Complete badge, open, delete with confirm); the dashboard shows the five most recent next to the home chat.
  - Polish: `AppNav` top bar, `SiteFooter`, `components/ui` (`buttonClass`, `cardClass`, `StatusBadge`, `TextField`, `Disclaimer`), `SaveIndicator`.
  - Disclaimer (`lib/disclaimer.ts`): above the preview and printed with the PDF, at the top of the Markdown download, in the footer and on the sign-up page.
- **Tests**:
  - pytest 234: auth, sessions, expiry, rate limits, documents (including cross-user access), the commit-before-response regression, the secure cookie, settings bounds.
  - Vitest 131: session, documents, autosave, disclaimer, api-client 204/401, chat storage.
- **Verified** with a local backend serving the export and real OpenAI:
  - sign up, then the home chat opens the NDA and the draft saves as `?doc=1`;
  - a reload and a fresh tab restore the values and the chat;
  - My documents lists it; sign out (the chat then answers 401); a wrong password is refused; sign in again;
  - a cleared cookie sends the user to sign in; delete works;
  - demo mode on a static server: demo sign-in, no My documents, the form works.

### Completed (PL-10) — Deploy the backend for free (Render Free + Neon Free) behind the Vercel frontend
- **Cost**: zero fixed cost; OpenAI usage is the only paid service. A first version used a paid Render instance plus a disk (SQLite); the user rejected it, so the design moved to free tiers.
- **Architecture**: browser → Vercel Hobby (static export) → `/api/*` rewrite (`frontend/vercel.json`) → Render Free web service `prelegal-api` (this Dockerfile) → Neon Free PostgreSQL 17 (+ OpenAI).
  - The browser sees one origin, so the `SameSite=Lax` cookie needs no CORS and no API URL variable.
- **Database layer** (`db.py`):
  - `open_database(settings)` returns `PostgresDatabase` when `DATABASE_URL` is set, otherwise `SqliteDatabase(db_path)`. It lives on `app.state.database`; `deps.get_db` yields a `db.Conn`.
  - Shared queries use `?` placeholders (`Conn` translates them to `%s` for psycopg), `RETURNING`, `ON CONFLICT DO NOTHING`, timestamps from Python, `COUNT(*) AS n`, and rows read by column name. Only the table definitions differ.
  - Emails are unique case-insensitively through a `lower(email)` index. `create_user` uses `ON CONFLICT DO NOTHING`, because a failed INSERT would abort a PostgreSQL transaction.
  - A `schema_version` table holds `SCHEMA_VERSION` (1); another version raises `SchemaVersionError`.
  - PostgreSQL uses psycopg 3 with `NullConnectionPool` (a connection per request, none held while idle, so Neon scales to zero), `prepare_threshold=None` for PgBouncer, and `dict_row`.
  - `init(reset=True)` is refused for PostgreSQL, and `Settings` rejects `db_reset` together with `database_url`.
- **Lazy LiteLLM** (`llm.py`): `load_litellm()` imports litellm once, behind a lock.
  - The lifespan starts `preload_litellm()` in a daemon thread. Importing it took 52 of the 65 s cold start at 0.1 CPU; the app is now healthy in about 20 s.
  - `StructuredLlm.prepare()` (LiteLLM: wait for the import) runs in `/api/chat` before the `Budget` starts.
  - `CHAT_TIMEOUT_MS` is 110 s (`lib/chat.ts`).
- **`ApiPathMiddleware`** (`main.py`), for `/api/*` only:
  - strips a trailing slash: on Vercel the `trailingSlash` redirect (308) runs before the rewrite, so every API call arrives as `/api/x/`. That is also why the rewrite source is `/api/(.*)`: `/api/:path*` doesn't match the slash, and with it the preview served the static 404 (found in the end-to-end run);
  - sets `Cache-Control: no-store`, because Vercel caches external rewrites when headers allow it.
- **Frontend cold starts** (`lib/backend.ts`, framework-free):
  - The status is `checking | waking | up | absent | down`. `classifyProbe` makes only a plain 404/405 mean "absent" (demo mode); timeouts, network errors, 5xx and an HTML 200 (Render's loading page) mean "waking".
  - `wake()` reports waking when a check fails or is still pending after 3 s (`SLOW_PROBE_MS`; a sleeping Render instance is held open, not refused), and retries `/api/health` with backoff (1/2/4/5 s) for up to 150 s (`WAKE_BUDGET_MS`), each probe at most 20 s, then reports "down".
  - The shared store dedups checks. `markBackendAnswered` runs on every JSON/204 answer through `api-client` `setApiHooks({beforeRequest, onBackendResponse})`.
  - `ensureAwake` (the `beforeRequest` hook) re-wakes after 10 quiet minutes (`AWAKE_FOR_MS`); Render sleeps at 15. `apiRequest` checks `signal.aborted` after the hook.
- **Frontend components**:
  - `useBackendStatus` / `useBackendReady` (`ready` = answered once on this page, so a later re-wake doesn't unmount a chat);
  - `BackendNotice` ("Starting the PreLegal server…" / "isn't responding" + Try again);
  - `BackendWarmup` in the root layout.
  - `AuthForm` keeps the form during a wake, with the button showing "Waiting for the server…". `DocumentBuilder` and `HomeChat` show the notice until ready; `ChatPanel`'s bubble says "Starting the server…" while waking.
  - `useChatAvailability` and `isChatAvailable` are gone.
  - `AppNav` fits a 390 px phone.
- **Docker**: `USER app`, no entrypoint (the disk version had one).
- **`render.yaml`**:
  - `plan: free`, `region: oregon`, `healthCheckPath: /api/health`, `autoDeployTrigger: checksPass`;
  - `OPENAI_API_KEY` and `DATABASE_URL` are `sync: false`;
  - `PRELEGAL_COOKIE_SECURE=true`, `PORT=8000`, `FORWARDED_ALLOW_IPS=*` (uvicorn takes the visitor's address from Vercel's `X-Forwarded-For`).
- **CI** (`.github/workflows/ci.yml`):
  - backend ruff + pytest on SQLite, and pytest on a `postgres:17` service;
  - frontend lint, `tsc`, Vitest, build;
  - the template validator.
- **Tests**:
  - pytest: 252 passed plus 1 skipped on SQLite, 253 on PostgreSQL 17. They cover persistence across restarts, isolation, the reset policy, `DATABASE_URL` parsing and secrecy, schema versions, rollback, cascade, case-insensitive emails, no idle PostgreSQL connections, lazy LiteLLM, prepare-before-budget, trailing slashes and `no-store`.
  - Vitest: 155, covering `backend.test.ts` (classify, wake/backoff/budget, slow first check, shared status, `ensureAwake`) and the `api-client` hooks.
- **Verified**:
  - **Docker at Render Free's limits** (`--cpus=0.1 --memory=512m`, PostgreSQL via `DATABASE_URL`):
    - healthy in 21 s, then 18 s on a redeploy;
    - sign-up while LiteLLM loads;
    - a real chat turn;
    - a brand-new container keeps the user, session and document;
    - another user gets a 404;
    - 0 idle connections, uid 999, about 225 MB.
  - **In the browser with agent-browser**, behind a local proxy that answers 503 HTML while "asleep":
    - the waking notice, a kept form, then sign-up;
    - the home chat explains a lease and opens a Promissory Note;
    - the NDA completes by chat;
    - demo mode still appears on a plain static host.
  - **End to end on the PR #14 Vercel preview** (Vercel Hobby → Render Free → Neon Free, real OpenAI; the preview is behind Vercel Authentication, reached with `vercel curl` and agent-browser plus the OIDC header):
    - found and fixed: the rewrite never matched (trailing-slash redirect, see above), and a cold start showed "Loading…" until the first check timed out (now `SLOW_PROBE_MS`);
    - sign-up, a wrong password refused, sign-out (then 401), sign-in; the cookie is `HttpOnly; Secure; SameSite=lax`;
    - the home chat opened the Mutual NDA, which was complete after three messages; the PDF (print) has every value and the disclaimer;
    - a second user gets 404 on GET/PUT/DELETE of the first user's document, an empty list, and 409 for the same email in other case;
    - cold starts after 17.5 idle minutes: about 30 s and 24 s. The proxies held the first health check open (no 5xx or HTML page seen); with `SLOW_PROBE_MS` the notice shows within 3 s and the form stays usable;
    - after waking in a new container and after a Render redeploy, both accounts, their sessions, the documents and the chat history were still there, and the first chat turn after a cold start worked;
    - Vercel team plan `hobby` with no environment variables; Render spun down when idle (a Free instance).

### To do (PL-1) — Simple website describing the PreLegal company

### API Endpoints
- `GET /api/health` - Health check
- `POST /api/auth/signup` - `{name, email, password}` → `{id, name, email}`, sets the session cookie (409 `email_taken`)
- `POST /api/auth/login` - `{email, password}` → the user, sets the cookie (401 `invalid_credentials`, 429 `too_many_attempts`)
- `POST /api/auth/logout` - ends the session and clears the cookie (204)
- `GET /api/auth/me` - the signed-in user (401 `not_authenticated`)
- `GET /api/documents` - the user's documents, newest first (no contents); `POST` creates one `{template_id, title?, values?, messages?}` (404 `unknown_template`, 409 `document_limit`)
- `GET|PUT|DELETE /api/documents/{id}` - one of the user's documents (404 `document_not_found`)
- `POST /api/chat` - One AI chat turn (signed in; 429 `chat_rate_limited`): `{template_id?, messages, values}` → `{reply, template_id, values, complete}`. Omit `template_id` to let the AI choose the document; a different response `template_id` means chosen or switched. Errors are `{"detail": {code, message, retryable}}`
- `GET /api/docs`, `GET /api/openapi.json` - API docs

## Latest update (2026-11-25)

- **PL-9 done**: merged in PR #13 (`d1b95e7`).
- **PL-10 implemented** on `feature/PL-10-render-backend`, PR #14 (see Completed (PL-10)), pending approval; do not merge without it. The Neon project, the Render Free service and the Vercel Git connection are created in their dashboards (README "First-time setup").

- **PL-6 done**: merged in PR #9 (`bae9788`); Jira status Listo.
- **PL-7 done**: AI chat for the Mutual NDA (see Completed (PL-7)), merged to `main` in PR #11 (`1cc1142`); Jira status Listo. The CLAUDE.md update from PR #10 was merged with it. Branches `feature/PL-7-ai-chat-mutual-nda` and `docs/claude-md-status` are kept.
- **PL-8 done**: merged to `main` in PR #12 (`41a4783`).
- **Verified for PL-7**:
  - backend and frontend tests, lint, type-check and builds pass;
  - the Docker image runs healthy as a non-root user;
  - real OpenAI calls (gpt-4.1-mini) in a browser end-to-end run: the NDA completes in two messages, and reload, Start over, per-user storage and the other templates' form all work;
  - the no-backend fallback to the form;
  - a bad API key returns `llm_not_configured`, and the key never appears in the logs.
- **Not verified**:
  - the mac/linux scripts on a real machine;
- **Known quirks**:
  - Locally, port 8000 is often taken by another container (`pm-mvp-api`); use `PRELEGAL_PORT=8001`.
  - pytest prints a Starlette deprecation warning about `httpx`; the fix is to switch the dev dependency to `httpx2`.
  - Rate limits live in memory: fine for the single instance, reset on restart or deploy (sessions persist).
  - Rate limits read the client address from `X-Forwarded-For` in production. Requests sent straight to the `onrender.com` URL can set that header themselves, which weakens only the per-address limits.
  - In Git Bash, `docker run -e VAR=/abs/path` is rewritten to a Windows path; use `MSYS_NO_PATHCONV=1`.
- **Next**: PL-1 (company website). Known follow-ups:
  - the same document open in two tabs is last-save-wins;
  - a save whose response is lost (a timeout after the server created it) is retried as a second document;
  - values the AI sends that are too long are dropped without telling the model;
  - no keep-alive ping (by choice), so the first visit after 15 idle minutes waits for a cold start;
  - Neon Free can only restore the last 6 hours.
