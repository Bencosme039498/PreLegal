"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  backendAnsweredOnce,
  checkBackend,
  getBackendStatus,
  installBackendHooks,
  subscribeBackendStatus,
  type BackendStatus,
} from "@/lib/backend";

/**
 * The backend's status, shared by every component on the page (one health check at a time):
 * "up" (chat, accounts and saving work), "absent" (static hosting: demo mode), or, while a free
 * instance wakes from sleep, "waking" until it answers or "down" if it never does.
 */
export function useBackendStatus(): BackendStatus {
  const status = useSyncExternalStore(subscribeBackendStatus, getBackendStatus, () => "checking" as const);
  useEffect(() => {
    installBackendHooks();
    void checkBackend();
  }, []);
  return status;
}

/**
 * The status, plus `ready`: the backend has answered on this page. Gate a chat on `ready`, not on
 * "up", so a later wake-up (after a long idle) doesn't unmount a conversation in progress.
 */
export function useBackendReady(): { status: BackendStatus; ready: boolean } {
  const status = useBackendStatus();
  return { status, ready: status === "up" || (status !== "absent" && backendAnsweredOnce()) };
}
