"use client";

import Link from "next/link";
import { clearSession } from "@/lib/session";
import { useSession } from "./useSession";

/** App header: brand, the signed-in user and sign out. Hidden when printing to PDF. */
export function UserBar() {
  const { user } = useSession();
  if (!user) return null;

  return (
    <div className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b-2 border-brand-yellow pb-3 print:hidden">
      <Link
        href="/"
        className="text-sm font-semibold tracking-wide text-brand-blue uppercase hover:text-brand-blue/80"
      >
        PreLegal
      </Link>
      <div className="flex items-center gap-3 text-sm">
        <span className="text-stone-600">
          Signed in as <span className="font-medium text-brand-navy">{user.name}</span>
          {!user.persisted && <span className="text-stone-500"> (this device only)</span>}
        </span>
        <button
          type="button"
          onClick={clearSession}
          className="rounded-md border border-stone-300 bg-white px-3 py-1.5 font-medium text-stone-800 shadow-sm hover:bg-stone-50"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
