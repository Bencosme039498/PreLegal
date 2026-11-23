"use client";

import { useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import {
  documentFilename,
  fillTemplate,
  initialValues,
  incompleteFields,
  type FieldSection,
  type FieldValues,
} from "@/lib/fill-template";
import { FieldInput } from "./FieldInput";

interface DocumentBuilderProps {
  /** Document name, used as the start of downloaded file names. */
  name: string;
  /** Template Markdown containing `{{field_key}}` placeholders. */
  body: string;
  /** The template's fields grouped into form sections (see groupFields). */
  sections: FieldSection[];
}

const REMARK_PLUGINS = [remarkGfm, remarkBreaks];

/** Form + live preview of a filled-in template, with Markdown and PDF downloads. */
export function DocumentBuilder({ name, body, sections }: DocumentBuilderProps) {
  const fields = useMemo(() => sections.flatMap((s) => s.fields), [sections]);
  const [values, setValues] = useState<FieldValues>(() => initialValues(fields));

  const markdown = useMemo(() => fillTemplate(body, fields, values), [body, fields, values]);
  const incomplete = incompleteFields(fields, values);
  const ready = incomplete.length === 0;
  // e.g. "Mutual-Non-Disclosure-Agreement_Acme-Inc_Globex-LLC": the document name plus the first two parties.
  const partyNames = sections.flatMap((s) => (s.nameKey ? [values[s.nameKey]] : [])).slice(0, 2);
  const filename = documentFilename(name, ...partyNames);

  const setValue = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }));

  const downloadMarkdown = () => {
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: `${filename}.md` });
    link.click();
    // Revoke on a later tick: some browsers cancel the download if the URL is revoked synchronously.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  // Browsers use the page title as the default "Save as PDF" file name.
  const downloadPdf = () => {
    const previousTitle = document.title;
    document.title = filename;
    window.addEventListener("afterprint", () => (document.title = previousTitle), { once: true });
    window.print();
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] print:block">
      <form className="space-y-6 print:hidden" onSubmit={(e) => e.preventDefault()} noValidate>
        {sections.map((section) => (
          <fieldset key={section.title} className="space-y-4 rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
            <legend className="px-1 text-sm font-semibold tracking-wide text-stone-500 uppercase">{section.title}</legend>
            {section.fields.map((field) => (
              <FieldInput key={field.key} field={field} value={values[field.key] ?? ""} onChange={setValue} />
            ))}
          </fieldset>
        ))}
      </form>

      <section aria-label="Document preview" className="lg:sticky lg:top-6 lg:self-start">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <p className="text-sm text-stone-600" aria-live="polite">
            {ready ? (
              <span className="font-medium text-emerald-700">All fields complete.</span>
            ) : (
              <>
                <span className="font-medium text-amber-700">
                  {incomplete.length} field{incomplete.length === 1 ? "" : "s"} to complete
                </span>
                {" · highlighted below"}
              </>
            )}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={downloadMarkdown}
              disabled={!ready}
              className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-800 shadow-sm hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Download Markdown
            </button>
            <button
              type="button"
              onClick={downloadPdf}
              disabled={!ready}
              className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Download PDF
            </button>
          </div>
        </div>

        <article
          className={
            "prose prose-stone max-w-none overflow-x-auto rounded-lg border border-stone-200 bg-white p-5 shadow-sm sm:p-8 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto " +
            "prose-headings:font-serif prose-h1:text-center prose-h1:text-2xl prose-h2:text-lg " +
            "prose-code:rounded prose-code:bg-amber-100 prose-code:px-1 prose-code:py-0.5 prose-code:font-sans prose-code:font-medium prose-code:text-amber-900 " +
            "prose-code:before:content-none prose-code:after:content-none " +
            "print:max-h-none print:overflow-visible print:rounded-none print:border-0 print:p-0 print:shadow-none"
          }
        >
          <Markdown remarkPlugins={REMARK_PLUGINS}>{markdown}</Markdown>
        </article>
      </section>
    </div>
  );
}
