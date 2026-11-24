"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { chatStorageKey, clearChat, greeting, loadChat, planHandoff, saveChat, type ChatMessage } from "@/lib/chat";
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
import { useChatAvailability } from "./useChatAvailability";

interface DocumentBuilderProps {
  /** Document name, used as the start of downloaded file names. */
  name: string;
  /** Template Markdown containing `{{field_key}}` placeholders. */
  body: string;
  /** The template's fields grouped into form sections (see groupFields). */
  sections: FieldSection[];
  /** The template's id: the AI chat about this document (the form is the fallback). */
  templateId: string;
}

const REMARK_PLUGINS = [remarkGfm, remarkBreaks];

/**
 * AI chat (or form) + live preview of a filled-in template, with Markdown and PDF downloads.
 *
 * Only rendered for a signed-in user (RequireSession), so never during prerendering: the lazy state
 * initialisers may read sessionStorage. The page keys it by template id, so switching documents
 * mounts a fresh instance.
 */
export function DocumentBuilder({ name, body, sections, templateId }: DocumentBuilderProps) {
  const fields = useMemo(() => sections.flatMap((s) => s.fields), [sections]);
  const { user } = useSession();
  const router = useRouter();
  const storageKey = user ? chatStorageKey(user.email, templateId) : null;
  const [saved] = useState(() => (storageKey ? loadChat(storageKey, fields.map((f) => f.key)) : null));
  const [values, setValues] = useState<FieldValues>(() => ({ ...initialValues(fields), ...saved?.values }));
  const [messages, setMessages] = useState<ChatMessage[]>(() => saved?.messages ?? []);
  /** The conversation started on the home page (it keeps the home greeting). */
  const fromHome = saved?.fromHome ?? false;
  // The assistant needs the backend: on a static-only host (Vercel, next dev) fall back to the form.
  const availability = useChatAvailability();
  /** The user chose to fill in the form by hand instead of chatting. */
  const [manual, setManual] = useState(false);
  const editor = availability === "checking" ? "checking" : availability === "available" && !manual ? "chat" : "form";

  // Keep the conversation and the document for this tab (sessionStorage is cleared when it closes).
  useEffect(() => {
    if (storageKey) saveChat(storageKey, { messages, values, fromHome });
  }, [storageKey, messages, values, fromHome]);

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

  // The AI switched to another document: its page picks up the conversation and carried values.
  const openDocument = (nextId: string, conversation: ChatMessage[], carried: FieldValues) => {
    if (!user || !storageKey) return;
    // This document's chat keeps the AI's answer too, so coming back doesn't offer to resend the switch.
    saveChat(storageKey, { messages: conversation, values, fromHome });
    const handoff = planHandoff(user.email, nextId, conversation, carried, fromHome);
    saveChat(handoff.key, handoff.chat);
    router.push(handoff.href);
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
        {editor === "chat" && (
          <ChatPanel
            templateId={templateId}
            greetingText={fromHome ? greeting() : greeting(name)}
            messages={messages}
            onMessages={setMessages}
            values={values}
            onValues={(updated) => setValues((prev) => ({ ...prev, ...updated }))}
            onReset={startOver}
            onNavigate={openDocument}
            onUseForm={() => setManual(true)}
          />
        )}
        {editor === "form" && (
          <>
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
