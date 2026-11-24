"use client";

import { useMemo, useSyncExternalStore } from "react";
import { parseUser, readStoredSession, subscribeSession, type SessionUser } from "@/lib/session";

export type SessionState =
  | { status: "loading"; user: null }
  | { status: "anonymous"; user: null }
  | { status: "authenticated"; user: SessionUser };

// During prerendering and hydration the session is unknown: rendering "loading" there keeps the
// client's first render identical to the static HTML, then React re-renders with localStorage.
const UNKNOWN = undefined;
const getServerSnapshot = () => UNKNOWN;

/** The signed-in user from localStorage, kept in sync across components and tabs. */
export function useSession(): SessionState {
  const raw = useSyncExternalStore<string | null | undefined>(subscribeSession, readStoredSession, getServerSnapshot);
  return useMemo((): SessionState => {
    if (raw === UNKNOWN) return { status: "loading", user: null };
    const user = parseUser(raw);
    return user ? { status: "authenticated", user } : { status: "anonymous", user: null };
  }, [raw]);
}
