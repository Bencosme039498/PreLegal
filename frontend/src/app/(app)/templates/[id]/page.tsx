import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentLoader } from "@/components/DocumentLoader";
import { groupFields } from "@/lib/fill-template";
import { listTemplates, loadTemplate } from "@/lib/templates";

/** Prerender one page per catalog template at build time. */
export function generateStaticParams() {
  return listTemplates().map((t) => ({ id: t.id }));
}

export async function generateMetadata({ params }: PageProps<"/templates/[id]">): Promise<Metadata> {
  const template = loadTemplate((await params).id);
  return template ? { title: template.name, description: template.description } : {};
}

export default async function TemplatePage({ params }: PageProps<"/templates/[id]">) {
  const template = loadTemplate((await params).id);
  if (!template) notFound();

  return (
    <>
      <header className="mb-6 print:hidden">
        <nav aria-label="Breadcrumb" className="text-sm text-stone-500">
          <Link href="/" className="font-medium text-brand-blue hover:text-brand-blue/80">
            Dashboard
          </Link>
          <span aria-hidden="true" className="mx-2">
            /
          </span>
          <span>{template.name}</span>
        </nav>
        <h1 className="mt-2 font-serif text-3xl font-semibold text-brand-navy">{template.name}</h1>
        <p className="mt-2 max-w-3xl text-stone-600">
          {template.description} Chat with the drafting assistant and it fills in the document as you answer.
          When every field is complete, download it as a PDF or Markdown file.
        </p>
      </header>

      {/* Keyed so that switching documents (client-side navigation) starts from a fresh state. */}
      <DocumentLoader
        key={template.id}
        name={template.name}
        body={template.body}
        sections={groupFields(template.fields)}
        templateId={template.id}
      />
    </>
  );
}
