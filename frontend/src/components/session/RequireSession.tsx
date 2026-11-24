"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "./useSession";

/**
 * Client-side gate for the app pages: sends visitors without a session to the sign-in screen.
 * Children only render once a user is known, so signed-out visitors never see app content flash.
 */
export function RequireSession({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "anonymous") router.replace("/login/");
  }, [status, router]);

  if (status !== "authenticated") {
    return (
      <p role="status" className="py-24 text-center text-sm text-stone-500 print:hidden">
        Loading…
      </p>
    );
  }
  return children;
}
