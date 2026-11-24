// Debounced, one-at-a-time saving of a changing snapshot (a document draft). Framework-free so it can
// be unit tested with fake timers; components/useDocumentAutosave.ts wires it to React.

export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

export interface AutosaverOptions<S> {
  /** Persists one snapshot. Rejecting marks the save as failed; the snapshot stays unsaved. */
  save: (snapshot: S) => Promise<void>;
  onStatus?: (status: SaveStatus) => void;
  delayMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface Autosaver<S> {
  /** Saves `snapshot` after the delay (a newer snapshot replaces an older one that wasn't saved yet). */
  schedule(snapshot: S): void;
  /** Saves the unsaved snapshot now (if any), after any save in flight. Resolves when done. */
  flush(): Promise<void>;
  /** Whether there is a snapshot that hasn't been saved. */
  hasUnsaved(): boolean;
  /** Stops the timer; an in-flight save still completes. */
  dispose(): void;
}

/** Autosavers that haven't been disposed (the drafts open on this page). */
const live = new Set<Autosaver<never>>();

/** Saves every open draft's pending changes now, e.g. before signing out ends the session. */
export async function flushAllAutosavers(): Promise<void> {
  await Promise.all([...live].map((autosaver) => autosaver.flush().catch(() => {})));
}

export function createAutosaver<S>({
  save,
  onStatus = () => {},
  delayMs = 800,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}: AutosaverOptions<S>): Autosaver<S> {
  let unsaved: { snapshot: S } | null = null;
  let timer: unknown = null;
  let inFlight: Promise<void> | null = null;

  const stopTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  // Saves snapshots until none is left; one save at a time, so a create is never sent twice.
  const run = (): Promise<void> => {
    if (inFlight) return inFlight;
    if (!unsaved) return Promise.resolve();
    inFlight = (async () => {
      while (unsaved) {
        const { snapshot } = unsaved;
        unsaved = null;
        onStatus("saving");
        try {
          await save(snapshot);
        } catch {
          unsaved ??= { snapshot }; // keep it for a retry, unless a newer one arrived meanwhile
          onStatus("error");
          return;
        }
      }
      onStatus("saved");
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  const autosaver: Autosaver<S> = {
    schedule(snapshot) {
      unsaved = { snapshot };
      stopTimer();
      if (!inFlight) onStatus("pending");
      timer = setTimer(() => {
        timer = null;
        void run();
      }, delayMs);
    },
    async flush() {
      stopTimer();
      if (inFlight) await inFlight;
      await run();
    },
    hasUnsaved: () => unsaved !== null,
    dispose() {
      stopTimer();
      live.delete(autosaver);
    },
  };
  live.add(autosaver);
  return autosaver;
}
