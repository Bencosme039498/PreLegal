"use client";

import { retryBackend, type BackendStatus } from "@/lib/backend";
import { buttonClass } from "./ui/button";
import { useBackendStatus } from "./useBackendStatus";

/**
 * Explains a sleeping backend instead of falling back to demo mode: "Starting the server…" while a
 * free instance wakes up, then "isn't responding" with Try again if it doesn't. Renders nothing
 * in any other state.
 */
export function BackendNotice({ status, className = "" }: { status: BackendStatus; className?: string }) {
  if (status === "waking") {
    return (
      <div role="status" className={`flex gap-3 rounded-lg border border-brand-blue/30 bg-brand-blue/5 px-4 py-3 text-sm text-stone-700 ${className}`}>
        <span
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 animate-spin rounded-full border-2 border-brand-blue/30 border-t-brand-blue motion-reduce:animate-none"
        />
        <p>
          <strong className="font-semibold text-brand-navy">Starting the PreLegal server…</strong> It sleeps when
          nobody has used it for a while, so waking up can take up to a minute. You can keep this page open: it
          continues on its own.
        </p>
      </div>
    );
  }
  if (status === "down") {
    return (
      <div role="alert" className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 ${className}`}>
        <p>The PreLegal server isn&apos;t responding right now. Your work on this page is kept.</p>
        <button type="button" onClick={() => void retryBackend()} className={buttonClass("secondary", "sm")}>
          Try again
        </button>
      </div>
    );
  }
  return null;
}

/** Wakes the backend as soon as any page loads, so it is usually ready by the time it's needed. */
export function BackendWarmup() {
  // The hook starts the shared health check (and installs the wake-before-send hooks).
  useBackendStatus();
  return null;
}
