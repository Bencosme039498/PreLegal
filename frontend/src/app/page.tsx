import { NdaBuilder, type FieldSection } from "@/components/NdaBuilder";
import { loadTemplate } from "@/lib/templates";

const template = loadTemplate("mutual-nda");

const byPrefix = (prefix: string) => template.fields.filter((f) => f.key.startsWith(prefix));

const sections: FieldSection[] = [
  { title: "Party A", fields: byPrefix("party_a_") },
  { title: "Party B", fields: byPrefix("party_b_") },
  { title: "Agreement terms", fields: template.fields.filter((f) => !f.key.startsWith("party_")) },
];

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8 print:max-w-none print:p-0">
      <header className="mb-8 print:hidden">
        <p className="text-sm font-semibold tracking-wide text-indigo-600 uppercase">PreLegal</p>
        <h1 className="mt-1 font-serif text-3xl font-semibold text-stone-900">{template.name} creator</h1>
        <p className="mt-2 max-w-3xl text-stone-600">
          Fill in the details below and the agreement updates as you type. When every required field is complete,
          download it as a PDF or Markdown file.
        </p>
      </header>

      <NdaBuilder body={template.body} fields={template.fields} sections={sections} fileBase="Mutual-NDA" />

      <footer className="mt-10 border-t border-stone-200 pt-4 text-xs text-stone-500 print:hidden">
        This template is a general-purpose starting point and is <strong>not legal advice</strong>. It has not been
        tailored to any jurisdiction; have a qualified attorney review it before use.
      </footer>
    </main>
  );
}
