/** A JSON request the backend understood and rejected (e.g. 422 validation errors). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: unknown,
  ) {
    super(`API request failed with status ${status}`);
    this.name = "ApiError";
  }
}

/**
 * No PreLegal backend answered: network failure, timeout, or a response that isn't our JSON API
 * (e.g. the static Vercel deployment returning an HTML 404/405 for /api/*).
 */
export class ApiUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("PreLegal API is unavailable", { cause });
    this.name = "ApiUnavailableError";
  }
}

/** The backend's coded error detail: {"detail": {"code", "message", "retryable"}}. */
export interface ErrorEnvelope {
  code: string;
  message: string;
  retryable: boolean;
}

export function isErrorEnvelope(detail: unknown): detail is ErrorEnvelope {
  if (!detail || typeof detail !== "object") return false;
  const { code, message, retryable } = detail as Record<string, unknown>;
  return typeof code === "string" && typeof message === "string" && typeof retryable === "boolean";
}

const DEFAULT_TIMEOUT_MS = 5000;

/** AbortSignal.any, with a fallback for browsers without it (Safari < 17.4, Firefox < 124). */
function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

export interface ApiRequestInit extends RequestInit {
  timeoutMs?: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Calls the same-origin backend and returns its JSON body.
 *
 * A coded error envelope is an ApiError whatever its status (the backend answered and explained,
 * e.g. a 504 when the AI provider timed out). Otherwise a 404/405/5xx or non-JSON response means
 * "no backend" (ApiUnavailableError), so callers can degrade gracefully on a static-only host.
 */
export async function apiRequest<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch, headers, signal, ...rest } = init;
  const timeout = AbortSignal.timeout(timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(path, {
      ...rest,
      headers: { "Content-Type": "application/json", ...headers },
      signal: signal ? anySignal([signal, timeout]) : timeout,
    });
  } catch (error) {
    throw new ApiUnavailableError(error);
  }

  const isJson = res.headers.get("content-type")?.includes("application/json") ?? false;
  if (!isJson) throw new ApiUnavailableError(`HTTP ${res.status}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch (error) {
    throw new ApiUnavailableError(error);
  }
  if (res.ok) return body as T;

  const detail = (body as { detail?: unknown } | null)?.detail;
  if (isErrorEnvelope(detail)) throw new ApiError(res.status, detail);
  if (res.status === 404 || res.status === 405 || res.status >= 500) throw new ApiUnavailableError(`HTTP ${res.status}`);
  throw new ApiError(res.status, detail);
}
