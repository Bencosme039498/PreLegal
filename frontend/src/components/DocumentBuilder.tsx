"use client";

import { useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { chatStorageKey, clearChat, isChatAvailable, loadChat, saveChat, type ChatMessage } from "@/lib/chat";
import {
  documentFilename,
  fillTemplate,
  initialValues,
  incompleteFields,
  type FieldSection,
  type FieldValues,
} from "@/lib/fill-template";
import { ChatPanel } from "./ChatPanel";
import { FormEditor } from "./FormEditor";
import { useSession } from "./session/useSession";

interface DocumentBuilderProps {
  /** Document name, used as the start of downloaded file names. */
  name: string;
  /** Template Markdown containing `{{field_key}}` placeholders. */
  body: string;
  /** The template's fields grouped into form sections (see groupFields). */
  sections: FieldSection[];
  /** Set when the AI assistant supports this template: the chat replaces the form. */
  chatTemplateId?: string;
}

/** Whether the AI assistant's backend answers here ("checking" until the health probe returns). */
type ChatAvailability = "checking" | "available" | "unavailable";

const REMARK_PLUGINS = [remarkGfm, remarkBreaks];

/**
 * AI chat (or form) + live preview of a filled-in template, with Markdown and PDF downloads.
 *
 * Only rendered for a signed-in user (RequireSession), so never during prerendering: the lazy state
 * initialisers may read sessionStorage.
 */
export function DocumentBuilder({ name, body, sections, chatTemplateId }: DocumentBuilderProps) {
  const fields = useMemo(() => sections.flatMap((s) => s.fields), [sections]);
  const { user } = useSession();
  const storageKey = chatTemplateId && user ? chatStorageKey(user.email, chatTemplateId) : null;
  const [saved] = useState(() => (storageKey ? loadChat(storageKey, fields.map((f) => f.key)) : null));
  const [values, setValues] = useState<FieldValues>(() => ({ ...initialValues(fields), ...saved?.values }));
  const [messages, setMessages] = useState<ChatMessage[]>(() => saved?.messages ?? []);
  const [availability, setAvailability] = useState<ChatAvailability>(chatTemplateId ? "checking" : "unavailable");
  /** The user chose to fill in the form by hand instead of chatting. */
  const [manual, setManual] = useState(false);
  const editor = availability === "checking" ? "checking" : availability === "available" && !manual ? "chat" : "form";

  // The assistant needs the backend: on a static-only host (Vercel, next dev) fall back to the form.
  useEffect(() => {
    if (!chatTemplateId) return;
    let active = true;
    void isChatAvailable().then((available) => {
      if (active) setAvailability(available ? "available" : "unavailable");
    });
    return () => {
      active = false;
    };
  }, [chatTemplateId]);

  // Keep the conversation and the document for this tab (sessionStorage is cleared when it closes).
  useEffect(() => {
    if (storageKey) saveChat(storageKey, { messages, values });
  }, [storageKey, messages, values]);

  const markdown = useMemo(() => fillTemplate(body, fields, values), [body, fields, values]);
  const incomplete = incompleteFields(fields, values);
  const ready = incomplete.length === 0;
  // e.g. "Mutual-Non-Disclosure-Agreement_Acme-Inc_Globex-LLC": the document name plus the first two parties.
  const partyNames = sections.flatMap((s) => (s.nameKey ? [values[s.nameKey]] : [])).slice(0, 2);
  const filename = documentFilename(name, ...partyNames);

  const setValue = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }));

  const startOver = () => {
    if (storageKey) clearChat(storageKey);
    setMessages([]);
    setValues(initialValues(fields));
  };

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
      <div className={editor === "chat" ? "lg:sticky lg:top-6 lg:self-start print:hidden" : "print:hidden"}>
        {editor === "checking" && (
          <p role="status" className="py-12 text-center text-sm text-stone-500">
            Connecting to the drafting assistant…
          </p>
        )}
        {editor === "chat" && chatTemplateId && (
          <ChatPanel
            templateId={chatTemplateId}
            documentName={name}
            messages={messages}
            onMessages={setMessages}
            values={values}
            onValues={(updated) => setValues((prev) => ({ ...prev, ...updated }))}
            onReset={startOver}
            onUseForm={() => setManual(true)}
          />
        )}
        {editor === "form" && (
          <>
            {chatTemplateId && (
              <p className="mb-4 rounded-lg border border-brand-yellow/60 bg-brand-yellow/10 px-4 py-3 text-sm text-stone-700">
                {availability === "available" ? (
                  <>
                    You&apos;re filling in the form by hand.{" "}
                    <button
                      type="button"
                      onClick={() => setManual(false)}
                      className="font-medium text-brand-blue underline hover:text-brand-blue/80"
                    >
                      Back to the assistant
                    </button>
                  </>
                ) : (
                  "The AI drafting assistant isn't available here, so fill in the form instead."
                )}
              </p>
            )}
            <FormEditor sections={sections} values={values} onChange={setValue} />
          </>
        )}
      </div>

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
              className="rounded-md bg-brand-purple px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-purple/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Download PDF
            </button>
          </div>
        </div>

        <article
          className={
            "prose prose-stone max-w-none overflow-x-auto rounded-lg border border-stone-200 bg-white p-5 shadow-sm sm:p-8 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto " +
            "prose-headings:font-serif prose-headings:text-brand-navy prose-h1:text-center prose-h1:text-2xl prose-h2:text-lg " +
            "prose-code:rounded prose-code:bg-brand-yellow/25 prose-code:px-1 prose-code:py-0.5 prose-code:font-sans prose-code:font-medium prose-code:text-brand-navy " +
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
