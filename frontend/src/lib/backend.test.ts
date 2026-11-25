import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, ApiUnavailableError, apiRequest } from "./api-client";
import {
  AWAKE_FOR_MS,
  PROBE_TIMEOUT_MS,
  WAKE_BUDGET_MS,
  backendAnsweredOnce,
  backoffMs,
  checkBackend,
  classifyProbe,
  ensureAwake,
  getBackendStatus,
  installBackendHooks,
  markBackendAnswered,
  resetBackendForTests,
  retryBackend,
  subscribeBackendStatus,
  wake,
} from "./backend";

afterEach(() => resetBackendForTests());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const html = (status: number) => new Response("<!doctype html><p>…</p>", { status, headers: { "Content-Type": "text/html" } });

/** A fake clock whose sleep() advances it, so a whole wake-up runs instantly. */
function fakeTime() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

/** A probe that fails `failures` times (as a waking host does), then answers. */
function probeFailing(failures: number, error: unknown = new ApiUnavailableError("timeout")) {
  let calls = 0;
  const probe = vi.fn(async () => {
    calls += 1;
    if (calls <= failures) throw error;
    return { status: "ok" };
  });
  return probe;
}

describe("classifyProbe", () => {
  it("is up when the health check answers, even with an error from the backend itself", () => {
    expect(classifyProbe(null)).toBe("up");
    expect(classifyProbe(new ApiError(429, { code: "x", message: "y", retryable: true }))).toBe("up");
  });

  it.each([404, 405])("is absent for a static host's plain %i (no backend: demo mode)", (status) => {
    expect(classifyProbe(new ApiUnavailableError(`HTTP ${status}`, status))).toBe("absent");
  });

  it.each([
    ["a timeout or network error", new ApiUnavailableError(new TypeError("Failed to fetch"))],
    ["a proxy 502 (e.g. Vercel's ROUTER_EXTERNAL_TARGET_ERROR)", new ApiUnavailableError("HTTP 502", 502)],
    ["a 503 or 504", new ApiUnavailableError("HTTP 503", 503)],
    ["the host's HTML loading page (200)", new ApiUnavailableError("HTTP 200", 200)],
  ])("is waking for %s, never demo mode", (_, error) => {
    expect(classifyProbe(error)).toBe("waking");
  });

  it("classifies real apiRequest failures", async () => {
    const outcome = (res: Response) =>
      apiRequest("/api/health", { fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(res) }).then(
        () => classifyProbe(null),
        (e: unknown) => classifyProbe(e),
      );
    await expect(outcome(json(200, { status: "ok" }))).resolves.toBe("up");
    await expect(outcome(html(404))).resolves.toBe("absent");
    await expect(outcome(html(502))).resolves.toBe("waking");
    await expect(outcome(html(200))).resolves.toBe("waking");
  });
});

describe("wake", () => {
  it("backs off 1, 2, 4, then 5 s between checks", () => {
    expect([0, 1, 2, 3, 4, 10].map(backoffMs)).toEqual([1000, 2000, 4000, 5000, 5000, 5000]);
  });

  it("is up at once when the backend answers", async () => {
    const onWaking = vi.fn();
    await expect(wake({ probe: probeFailing(0), onWaking, ...fakeTime() })).resolves.toBe("up");
    expect(onWaking).not.toHaveBeenCalled();
  });

  it("keeps checking through a cold start, reporting waking once", async () => {
    const probe = probeFailing(6);
    const onWaking = vi.fn();
    await expect(wake({ probe, onWaking, ...fakeTime() })).resolves.toBe("up");
    expect(probe).toHaveBeenCalledTimes(7);
    expect(onWaking).toHaveBeenCalledTimes(1);
  });

  it("reports waking while a first check is held open by a sleeping host, before its timeout", async () => {
    vi.useFakeTimers();
    try {
      let answer!: () => void;
      const probe = vi.fn(() => new Promise<void>((resolve) => (answer = resolve)));
      const onWaking = vi.fn();
      const result = wake({ probe, onWaking, slowAfterMs: 3000 });
      await vi.advanceTimersByTimeAsync(2999);
      expect(onWaking).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(onWaking).toHaveBeenCalledTimes(1);
      answer(); // the backend has booted and answers the same check
      await expect(result).resolves.toBe("up");
      expect(onWaking).toHaveBeenCalledTimes(1);
      expect(probe).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("doesn't report waking later for a check that answered quickly", async () => {
    vi.useFakeTimers();
    try {
      const onWaking = vi.fn();
      await expect(wake({ probe: probeFailing(0), onWaking, slowAfterMs: 3000 })).resolves.toBe("up");
      await vi.advanceTimersByTimeAsync(10_000);
      expect(onWaking).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops at once for a static host", async () => {
    const probe = probeFailing(99, new ApiUnavailableError("HTTP 404", 404));
    await expect(wake({ probe, ...fakeTime() })).resolves.toBe("absent");
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("gives up (down) once the time budget is spent", async () => {
    const time = fakeTime();
    const probe = vi.fn(async (timeoutMs: number) => {
      time.advance(timeoutMs); // every check times out
      throw new ApiUnavailableError("timeout");
    });
    await expect(wake({ probe, ...time })).resolves.toBe("down");
    expect(time.now()).toBeGreaterThanOrEqual(WAKE_BUDGET_MS);
    expect(time.now()).toBeLessThan(WAKE_BUDGET_MS + PROBE_TIMEOUT_MS);
    // No check is allowed past the budget.
    for (const [timeoutMs] of probe.mock.calls) expect(timeoutMs).toBeLessThanOrEqual(PROBE_TIMEOUT_MS);
  });
});

describe("shared status", () => {
  it("goes checking → waking → up, telling subscribers", async () => {
    const seen: string[] = [];
    subscribeBackendStatus(() => seen.push(getBackendStatus()));
    expect(getBackendStatus()).toBe("checking");
    await checkBackend({ probe: probeFailing(2), ...fakeTime() });
    expect(seen).toEqual(["waking", "up"]);
    expect(backendAnsweredOnce()).toBe(true);
  });

  it("shares one check between concurrent callers", async () => {
    const probe = probeFailing(1);
    const time = fakeTime();
    const [a, b] = await Promise.all([checkBackend({ probe, ...time }), checkBackend({ probe, ...time })]);
    expect([a, b]).toEqual(["up", "up"]);
    expect(probe).toHaveBeenCalledTimes(2); // one failed check and one success, not four
  });

  it("is absent (demo mode) on a static host and stays so", async () => {
    await checkBackend({ probe: probeFailing(99, new ApiUnavailableError("HTTP 404", 404)), ...fakeTime() });
    expect(getBackendStatus()).toBe("absent");
    markBackendAnswered();
    expect(getBackendStatus()).toBe("absent");
    expect(backendAnsweredOnce()).toBe(false);
  });

  it("recovers from down with Try again, or when any request gets an answer", async () => {
    const time = fakeTime();
    const timingOut = vi.fn(async (ms: number) => {
      time.advance(ms);
      throw new ApiUnavailableError("timeout");
    });
    await checkBackend({ probe: timingOut, ...time });
    expect(getBackendStatus()).toBe("down");
    markBackendAnswered();
    expect(getBackendStatus()).toBe("up");
    // retryBackend forces a new check even though the status is known.
    resetBackendForTests();
    await checkBackend({ probe: timingOut, ...time });
    expect(getBackendStatus()).toBe("down");
    const healthy = vi.fn<typeof fetch>().mockResolvedValue(json(200, { status: "ok" }));
    vi.stubGlobal("fetch", healthy);
    try {
      await expect(retryBackend()).resolves.toBe("up");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("ensureAwake (wake before send)", () => {
  it("doesn't check while the backend answered recently", async () => {
    markBackendAnswered(1_000);
    const fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      await ensureAwake(1_000 + AWAKE_FOR_MS - 1);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("wakes the backend first after a long idle", async () => {
    markBackendAnswered(1_000);
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(json(200, { status: "ok" }));
    vi.stubGlobal("fetch", fetchSpy);
    try {
      await ensureAwake(1_000 + AWAKE_FOR_MS);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe("/api/health");
  });

  it("does nothing on a static host", async () => {
    await checkBackend({ probe: probeFailing(99, new ApiUnavailableError("HTTP 404", 404)), ...fakeTime() });
    const fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      await ensureAwake();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("runs before API requests once installed, and every answer counts as awake", async () => {
    installBackendHooks();
    const calls: string[] = [];
    const fetchSpy = vi.fn<typeof fetch>(async (input) => {
      calls.push(String(input));
      return json(200, { ok: true });
    });
    vi.stubGlobal("fetch", fetchSpy);
    try {
      await apiRequest("/api/documents");
      await apiRequest("/api/documents");
    } finally {
      vi.unstubAllGlobals();
    }
    // The first request woke the backend first; the second didn't need to.
    expect(calls).toEqual(["/api/health", "/api/documents", "/api/documents"]);
    expect(getBackendStatus()).toBe("up");
  });
});
