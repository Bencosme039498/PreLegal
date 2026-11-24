import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Page not found" };

/** Exported as out/404.html, which the backend serves for unknown paths. */
export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-24 text-center">
      <p className="text-sm font-semibold tracking-wide text-brand-blue uppercase">404</p>
      <h1 className="mt-1 font-serif text-3xl font-semibold text-brand-navy">Page not found</h1>
      <p className="mt-2 text-stone-600">That page doesn&apos;t exist. It may have been moved or the link is wrong.</p>
      <Link href="/" className="mt-6 inline-block text-sm font-medium text-brand-blue hover:text-brand-blue/80">
        <span aria-hidden="true">←</span> Back to the dashboard
      </Link>
    </main>
  );
}
