import Link from "next/link";
import { HomeChat } from "@/components/HomeChat";
import { Welcome } from "@/components/Welcome";
import { DocumentsList } from "@/components/documents/DocumentsList";
import { cardClass } from "@/components/ui/button";
import { listTemplates } from "@/lib/templates";

const templates = listTemplates();
const templateNames = Object.fromEntries(templates.map((t) => [t.id, t.name]));

const categoryLabel = (category: string) => category.replace(/-/g, " ");

export default function Dashboard() {
  return (
    <>
      <header className="mb-8">
        <Welcome />
        <p className="mt-2 max-w-3xl text-stone-600">
          Tell the drafting assistant what you need, or pick a template below. Fill in the key details and download
          the agreement as a PDF or Markdown file.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <HomeChat />
        <section aria-labelledby="recent-title">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 id="recent-title" className="font-serif text-xl font-semibold text-brand-navy">
              Recent documents
            </h2>
            <Link href="/documents/" className="text-sm font-medium text-brand-blue hover:text-brand-blue/80">
              View all
            </Link>
          </div>
          <DocumentsList templateNames={templateNames} limit={5} />
        </section>
      </div>

      <h2 className="mt-12 mb-3 font-serif text-xl font-semibold text-brand-navy">Start from a template</h2>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {templates.map((t) => (
          <li key={t.id}>
            <Link
              href={`/templates/${t.id}/`}
              className={`${cardClass} group flex h-full flex-col p-5 transition hover:-translate-y-0.5 hover:border-brand-blue/60 hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:outline-none`}
            >
              <span className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                {categoryLabel(t.category)}
              </span>
              <span className="mt-1 font-serif text-lg font-semibold text-brand-navy">{t.name}</span>
              <span className="mt-2 flex-1 text-sm text-stone-600">{t.description}</span>
              <span className="mt-4 text-sm font-medium text-brand-blue">
                Start drafting{" "}
                <span aria-hidden="true" className="inline-block transition group-hover:translate-x-0.5">
                  →
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
