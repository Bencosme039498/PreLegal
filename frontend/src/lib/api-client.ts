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

const DEFAULT_TIMEOUT_MS = 5000;

export interface ApiRequestInit extends RequestInit {
  timeoutMs?: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Calls the same-origin backend and returns its JSON body.
 *
 * A 404/405/5xx or non-JSON response is treated as "no backend" (ApiUnavailableError), so callers
 * can degrade gracefully on a static-only host. Features that need to tell a real JSON 404 apart
 * should inspect ApiError instead once they exist.
 */
export async function apiRequest<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetchImpl(path, {
      ...rest,
      headers: { "Content-Type": "application/json", ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new ApiUnavailableError(error);
  }

  const isJson = res.headers.get("content-type")?.includes("application/json") ?? false;
  if (!isJson || res.status === 404 || res.status === 405 || res.status >= 500) {
    throw new ApiUnavailableError(`HTTP ${res.status}`);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (error) {
    throw new ApiUnavailableError(error);
  }
  if (!res.ok) throw new ApiError(res.status, (body as { detail?: unknown } | null)?.detail);
  return body as T;
}
