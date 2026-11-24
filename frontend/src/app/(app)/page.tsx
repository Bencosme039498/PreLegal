import Link from "next/link";
import { HomeChat } from "@/components/HomeChat";
import { listTemplates } from "@/lib/templates";

const templates = listTemplates();

const categoryLabel = (category: string) => category.replace(/-/g, " ");

export default function Home() {
  return (
    <>
      <header className="mb-8">
        <h1 className="font-serif text-3xl font-semibold text-brand-navy">Draft a legal agreement</h1>
        <p className="mt-2 max-w-3xl text-stone-600">
          Tell the drafting assistant what you need, or pick a document below. Fill in the key details and download
          the completed agreement as a PDF or Markdown file.
        </p>
      </header>

      <HomeChat />

      <h2 className="mb-3 font-serif text-xl font-semibold text-brand-navy">Choose a document</h2>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((t) => (
          <li key={t.id}>
            <Link
              href={`/templates/${t.id}`}
              className="flex h-full flex-col rounded-lg border border-stone-200 bg-white p-5 shadow-sm transition hover:border-brand-blue/60 hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:outline-none"
            >
              <span className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                {categoryLabel(t.category)}
              </span>
              <span className="mt-1 font-serif text-lg font-semibold text-brand-navy">{t.name}</span>
              <span className="mt-2 flex-1 text-sm text-stone-600">{t.description}</span>
              <span className="mt-4 text-sm font-medium text-brand-blue">
                Start drafting <span aria-hidden="true">→</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
