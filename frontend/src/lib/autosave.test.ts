import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosaver, flushAllAutosavers, type SaveStatus } from "./autosave";

/** A save whose completion the test controls. */
function controlledSave() {
  const saved: string[] = [];
  const pending: { resolve: () => void; reject: (e: Error) => void }[] = [];
  const save = vi.fn(
    (snapshot: string) =>
      new Promise<void>((resolve, reject) => {
        pending.push({
          resolve: () => {
            saved.push(snapshot);
            resolve();
          },
          reject,
        });
      }),
  );
  return { save, saved, pending };
}

describe("createAutosaver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces: only the latest snapshot is saved, once the changes pause", async () => {
    const save = vi.fn(async () => {});
    const statuses: SaveStatus[] = [];
    const saver = createAutosaver<string>({ save, delayMs: 800, onStatus: (s) => statuses.push(s) });
    saver.schedule("a");
    await vi.advanceTimersByTimeAsync(500);
    saver.schedule("ab");
    await vi.advanceTimersByTimeAsync(500);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(save).toHaveBeenCalledExactlyOnceWith("ab");
    expect(statuses).toEqual(["pending", "pending", "saving", "saved"]);
    expect(saver.hasUnsaved()).toBe(false);
  });

  it("runs one save at a time and then saves the newest change", async () => {
    const { save, saved, pending } = controlledSave();
    const saver = createAutosaver<string>({ save, delayMs: 10 });
    saver.schedule("first");
    await vi.advanceTimersByTimeAsync(10);
    saver.schedule("second");
    saver.schedule("third");
    await vi.advanceTimersByTimeAsync(10);
    expect(save).toHaveBeenCalledTimes(1); // "first" is still in flight

    pending[0].resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    pending[1].resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(saved).toEqual(["first", "third"]);
  });

  it("keeps a failed snapshot for a retry", async () => {
    const { save, saved, pending } = controlledSave();
    const statuses: SaveStatus[] = [];
    const saver = createAutosaver<string>({ save, delayMs: 10, onStatus: (s) => statuses.push(s) });
    saver.schedule("draft");
    await vi.advanceTimersByTimeAsync(10);
    pending[0].reject(new Error("offline"));
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses.at(-1)).toBe("error");
    expect(saver.hasUnsaved()).toBe(true);

    const flushed = saver.flush();
    await vi.advanceTimersByTimeAsync(0);
    pending[1].resolve();
    await flushed;
    expect(saved).toEqual(["draft"]);
    expect(statuses.at(-1)).toBe("saved");
  });

  it("a newer change during a failing save wins the retry", async () => {
    const { save, saved, pending } = controlledSave();
    const saver = createAutosaver<string>({ save, delayMs: 10 });
    saver.schedule("old");
    await vi.advanceTimersByTimeAsync(10);
    saver.schedule("new");
    pending[0].reject(new Error("offline"));
    await vi.advanceTimersByTimeAsync(0);
    const flushed = saver.flush();
    await vi.advanceTimersByTimeAsync(0);
    pending[1].resolve();
    await flushed;
    expect(save.mock.calls.map(([s]) => s)).toEqual(["old", "new"]);
    expect(saved).toEqual(["new"]);
  });

  it("flush saves at once and waits for it; nothing to save resolves immediately", async () => {
    const save = vi.fn(async () => {});
    const saver = createAutosaver<string>({ save, delayMs: 10_000 });
    await saver.flush();
    expect(save).not.toHaveBeenCalled();
    saver.schedule("now");
    await saver.flush();
    expect(save).toHaveBeenCalledExactlyOnceWith("now");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(save).toHaveBeenCalledTimes(1); // the timer was cancelled
  });

  it("dispose cancels a pending save", async () => {
    const save = vi.fn(async () => {});
    const saver = createAutosaver<string>({ save, delayMs: 10 });
    saver.schedule("x");
    saver.dispose();
    await vi.advanceTimersByTimeAsync(50);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("flushAllAutosavers", () => {
  it("saves every open draft now, skipping disposed ones and surviving failures", async () => {
    const saves: string[] = [];
    const ok = createAutosaver<string>({ save: async (s) => void saves.push(s), delayMs: 60_000 });
    const failing = createAutosaver<string>({ save: () => Promise.reject(new Error("offline")), delayMs: 60_000 });
    const disposed = createAutosaver<string>({ save: async (s) => void saves.push(s), delayMs: 60_000 });
    ok.schedule("open draft");
    failing.schedule("lost");
    disposed.schedule("closed");
    disposed.dispose();

    await flushAllAutosavers();
    expect(saves).toEqual(["open draft"]);
    expect(failing.hasUnsaved()).toBe(true);
    ok.dispose();
    failing.dispose();
  });
});
