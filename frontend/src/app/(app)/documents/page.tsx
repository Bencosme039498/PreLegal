import type { Metadata } from "next";
import Link from "next/link";
import { DocumentsList } from "@/components/documents/DocumentsList";
import { buttonClass } from "@/components/ui/button";
import { listTemplates } from "@/lib/templates";

export const metadata: Metadata = { title: "My documents" };

const templateNames = Object.fromEntries(listTemplates().map((t) => [t.id, t.name]));

export default function DocumentsPage() {
  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-brand-navy">My documents</h1>
          <p className="mt-2 text-stone-600">
            Every draft is saved as you work on it. Open one to keep editing or to download it again.
          </p>
        </div>
        <Link href="/" className={buttonClass("primary")}>
          New document
        </Link>
      </header>
      <DocumentsList templateNames={templateNames} />
    </>
  );
}
