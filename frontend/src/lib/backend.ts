// Is the PreLegal backend there, and awake? Framework-free (components/useBackendStatus.ts wires it
// to React) so the decisions below can be unit tested with fake time.
//
// In production the backend runs on a free instance that sleeps after 15 minutes without traffic and
// takes up to about a minute to wake. While it wakes, requests time out or come back as a proxy
// error or the host's HTML loading page. None of that means "there is no backend", so it is never
// treated as demo mode: only a static host's plain 404/405 is (the Vercel site without a rewrite,
// or `npm run dev`).

import { ApiError, ApiUnavailableError, HEALTH_PATH, apiRequest, setApiHooks } from "./api-client";

/**
 * - checking: the first health check hasn't answered yet
 * - waking:   the backend isn't answering yet; still trying (a cold start)
 * - up:       the backend answered
 * - absent:   there is no backend here (static hosting): demo mode
 * - down:     it didn't wake within the time limit; the user can try again
 */
export type BackendStatus = "checking" | "waking" | "up" | "absent" | "down";

/** What one failed (or successful) health check says about the backend. */
export type ProbeOutcome = "up" | "absent" | "waking";

/** Total time to keep trying before giving up (a cold start is about a minute, plus booting). */
export const WAKE_BUDGET_MS = 150_000;
/** One health check; a waking host may hold the request for a while before answering. */
export const PROBE_TIMEOUT_MS = 20_000;
/** The backend sleeps after 15 idle minutes: after 10 without an answer, check before sending. */
export const AWAKE_FOR_MS = 10 * 60_000;
/**
 * An awake backend answers a health check in well under a second. A sleeping one on Render is
 * usually not refused but held open by the proxies until it has booted (about 30 s measured), so a
 * check still pending after this long is reported as waking without waiting for its timeout.
 */
export const SLOW_PROBE_MS = 3_000;

export function classifyProbe(error: unknown): ProbeOutcome {
  if (error === null || error === undefined) return "up";
  // The backend answered, if not with a 200: it is awake.
  if (error instanceof ApiError) return "up";
  // A static host has no /api: it answers at once with a 404 (or 405 for the method).
  if (error instanceof ApiUnavailableError && (error.status === 404 || error.status === 405)) return "absent";
  // A timeout, a network error, a 5xx from the proxy, or an HTML loading page: still waking.
  return "waking";
}

/** Waits between health checks: 1 s, 2 s, 4 s, then every 5 s. */
export function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 5000);
}

export interface WakeOptions {
  /** One health check; rejects like apiRequest. */
  probe?: (timeoutMs: number) => Promise<unknown>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  budgetMs?: number;
  /** Called once, on the first failed or slow check: the UI shows "Starting the server…". */
  onWaking?: () => void;
  /** A check pending this long counts as waking (default SLOW_PROBE_MS). */
  slowAfterMs?: number;
}

const defaultProbe = (timeoutMs: number) => apiRequest(HEALTH_PATH, { timeoutMs });
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Health-checks until the backend answers, is clearly absent, or the time budget runs out. */
export async function wake({
  probe = defaultProbe,
  now = Date.now,
  sleep = defaultSleep,
  budgetMs = WAKE_BUDGET_MS,
  onWaking,
  slowAfterMs = SLOW_PROBE_MS,
}: WakeOptions = {}): Promise<"up" | "absent" | "down"> {
  let reportedWaking = false;
  const reportWaking = () => {
    if (reportedWaking) return;
    reportedWaking = true;
    onWaking?.();
  };
  const start = now();
  for (let attempt = 0; ; attempt++) {
    const left = budgetMs - (now() - start);
    if (left <= 0) return "down";
    let error: unknown = null;
    const slow = setTimeout(reportWaking, slowAfterMs);
    try {
      await probe(Math.min(PROBE_TIMEOUT_MS, left));
    } catch (e) {
      error = e;
    } finally {
      clearTimeout(slow);
    }
    const outcome = classifyProbe(error);
    if (outcome !== "waking") return outcome;
    reportWaking();
    if (now() - start >= budgetMs) return "down";
    await sleep(backoffMs(attempt));
  }
}

// ---- The page's shared status (one check at a time, shared by every component) ----

let status: BackendStatus = "checking";
let lastAnswerAt: number | null = null;
/** The backend has answered at least once on this page (it may have gone back to sleep since). */
let answeredOnce = false;
let inflight: Promise<BackendStatus> | null = null;
const listeners = new Set<() => void>();

function setStatus(next: BackendStatus): void {
  if (next === status) return;
  status = next;
  listeners.forEach((listener) => listener());
}

export const getBackendStatus = (): BackendStatus => status;

/**
 * Whether the backend has answered on this page. Components that started the chat keep showing it
 * while a later wake-up runs (the chat says "Starting the server…" itself), rather than unmounting it.
 */
export const backendAnsweredOnce = (): boolean => answeredOnce;

export function subscribeBackendStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The backend answered a request: it is up, and stays awake for a while. */
export function markBackendAnswered(at: number = Date.now()): void {
  lastAnswerAt = at;
  if (status === "absent") return;
  answeredOnce = true;
  setStatus("up");
}

/**
 * Checks (and if need be wakes) the backend. Concurrent callers share one check. A known status is
 * returned as is unless `force` (e.g. Try again, or the backend may have gone back to sleep).
 */
export function checkBackend({ force = false, ...options }: WakeOptions & { force?: boolean } = {}): Promise<BackendStatus> {
  if (inflight) return inflight;
  if (!force && status !== "checking") return Promise.resolve(status);
  inflight = (async () => {
    try {
      const result = await wake({ ...options, onWaking: () => setStatus("waking") });
      if (result === "up") markBackendAnswered(options.now?.());
      else setStatus(result);
      return status;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Try again after "down". */
export const retryBackend = (): Promise<BackendStatus> => checkBackend({ force: true });

/**
 * Before a request: if the backend may have gone to sleep (nothing answered for a while), wake it
 * first, so the request itself isn't the one that waits out the cold start (a chat turn could then
 * run past the proxy's 120 s limit, and a save could time out after the server had stored it).
 * Never throws: if the backend stays away, the request fails as usual and the caller reports it.
 */
export async function ensureAwake(now: number = Date.now()): Promise<void> {
  if (status === "absent") return;
  if (status === "up" && lastAnswerAt !== null && now - lastAnswerAt < AWAKE_FOR_MS) return;
  await checkBackend({ force: true });
}

let uninstall: (() => void) | null = null;

/** Routes every API request through ensureAwake and records each answer (idempotent). */
export function installBackendHooks(): void {
  if (uninstall) return;
  uninstall = setApiHooks({
    beforeRequest: () => ensureAwake(),
    onBackendResponse: () => markBackendAnswered(),
  });
}

/** Tests only: back to the initial state. */
export function resetBackendForTests(): void {
  uninstall?.();
  uninstall = null;
  status = "checking";
  lastAnswerAt = null;
  answeredOnce = false;
  inflight = null;
  listeners.clear();
}
