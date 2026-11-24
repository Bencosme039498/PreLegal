import type { SaveStatus } from "@/lib/autosave";

interface SaveIndicatorProps {
  /** Demo mode: nothing is saved. */
  demo: boolean;
  status: SaveStatus;
  /** The draft exists in "My documents" (it has been saved at least once). */
  saved: boolean;
  onRetry: () => void;
}

/** Where the draft's autosave stands: "Saving…", "Saved to My documents", or an error with Retry. */
export function SaveIndicator({ demo, status, saved, onRetry }: SaveIndicatorProps) {
  if (demo) return <span className="text-stone-500">Demo mode · not saved</span>;
  if (status === "error") {
    return (
      <span role="alert" className="text-red-700">
        Couldn&apos;t save.{" "}
        <button type="button" onClick={onRetry} className="font-medium underline">
          Retry
        </button>
      </span>
    );
  }
  if (status === "pending" || status === "saving") return <span className="text-stone-500">Saving…</span>;
  return (
    <span className="text-stone-500">
      {saved ? (
        <>
          <span aria-hidden="true" className="text-emerald-600">
            ✓
          </span>{" "}
          Saved to My documents
        </>
      ) : (
        "Saves automatically as you go"
      )}
    </span>
  );
}
