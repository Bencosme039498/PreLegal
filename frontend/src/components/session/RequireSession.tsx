"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { setUnauthenticatedHandler } from "@/lib/api-client";
import { fetchCurrentUser, forgetUser, saveSession } from "@/lib/session";
import { useChatAvailability } from "../useChatAvailability";
import { useSession } from "./useSession";

/**
 * Client-side gate for the app pages: sends visitors without a session to the sign-in screen.
 * Children only render once a user is known, so signed-out visitors never see app content flash.
 *
 * The stored user is only a cache: for an account it is checked against the session cookie
 * (GET /api/auth/me) on load, and any later 401 not_authenticated signs the user out here, e.g.
 * after the session expired or the server restarted with a fresh database. A demo user is signed
 * out when a backend answers, since accounts are available there.
 */
export function RequireSession({ children }: { children: React.ReactNode }) {
  const { status, user } = useSession();
  const router = useRouter();
  const availability = useChatAvailability();

  useEffect(() => {
    if (status === "anonymous") router.replace("/login/");
  }, [status, router]);

  // Any request that finds the session gone signs the user out of this tab.
  useEffect(() => setUnauthenticatedHandler(() => forgetUser(user)), [user]);

  // A demo sign-in (made without a backend) isn't an account: sign in properly where there is one.
  useEffect(() => {
    if (user && !user.persisted && availability === "available") forgetUser(user);
  }, [user, availability]);

  // Check the cached account against the session cookie.
  useEffect(() => {
    if (!user?.persisted) return;
    let active = true;
    fetchCurrentUser()
      .then((current) => {
        if (!active || current?.id === user.id) return;
        // Signed out, or signed in as someone else in another tab: follow the cookie.
        forgetUser(user);
        if (current) saveSession(current);
      })
      .catch(() => {
        // No answer (offline, or the server is restarting): keep the cached user; the next request tells.
      });
    return () => {
      active = false;
    };
  }, [user]);

  if (status !== "authenticated") {
    return (
      <p role="status" className="py-24 text-center text-sm text-stone-500 print:hidden">
        Loading…
      </p>
    );
  }
  return children;
}
