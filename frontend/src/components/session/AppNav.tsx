"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { flushAllAutosavers } from "@/lib/autosave";
import { signOut } from "@/lib/session";
import { buttonClass } from "../ui/button";
import { useSession } from "./useSession";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");

/** The app's top bar: brand, navigation, the signed-in user and Sign out. Hidden when printing. */
export function AppNav() {
  const { user } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  if (!user) return null;

  const links = [
    { href: "/", label: "Dashboard", active: pathname === "/" },
    // Demo mode has no saved documents.
    ...(user.persisted
      ? [{ href: "/documents/", label: "My documents", active: pathname.startsWith("/documents") }]
      : []),
  ];

  const leave = async () => {
    setSigningOut(true);
    await flushAllAutosavers(); // save open drafts while the session still exists
    await signOut(user);
    router.replace("/login/");
  };

  return (
    <header className="sticky top-0 z-20 border-b border-stone-200 bg-white/90 backdrop-blur print:hidden">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-3 px-4 sm:gap-6 sm:px-6 lg:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="PreLegal dashboard">
          <span
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-lg bg-brand-navy font-serif text-lg font-bold text-brand-yellow"
          >
            P
          </span>
          <span className="hidden font-serif text-lg font-semibold text-brand-navy sm:inline">PreLegal</span>
        </Link>

        <nav aria-label="Main" className="flex items-center gap-1">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={link.active ? "page" : undefined}
              className={
                "rounded-md px-2 py-2 text-sm font-medium whitespace-nowrap transition-colors sm:px-3 " +
                (link.active ? "bg-stone-100 text-brand-navy" : "text-stone-600 hover:bg-stone-50 hover:text-brand-navy")
              }
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-3">
          {!user.persisted && (
            <span className="hidden rounded-full bg-brand-blue/10 px-2.5 py-1 text-xs font-medium text-brand-navy sm:inline">
              Demo mode · nothing is saved
            </span>
          )}
          <div className="hidden items-center gap-2 sm:flex">
            <span
              aria-hidden="true"
              className="flex size-8 items-center justify-center rounded-full bg-brand-blue/15 text-xs font-semibold text-brand-navy"
            >
              {initials(user.name)}
            </span>
            <span className="text-right leading-tight">
              <span className="block text-sm font-medium text-brand-navy">{user.name}</span>
              <span className="block text-xs text-stone-500">{user.email}</span>
            </span>
          </div>
          <button type="button" onClick={() => void leave()} disabled={signingOut} className={buttonClass("secondary", "sm")}>
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </div>
    </header>
  );
}
