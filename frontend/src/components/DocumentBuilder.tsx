"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { chatStorageKey, greeting, planHandoff, saveChat, type ChatMessage, type StoredChat } from "@/lib/chat";
import { withDisclaimer } from "@/lib/disclaimer";
import { documentHref, documentTitle, type DocumentContent } from "@/lib/documents";
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
import { SaveIndicator } from "./SaveIndicator";
import { useSession } from "./session/useSession";
import { Disclaimer } from "./ui/Disclaimer";
import { buttonClass } from "./ui/button";
import { useChatAvailability } from "./useChatAvailability";
import { useDocumentAutosave } from "./useDocumentAutosave";

interface DocumentBuilderProps {
  /** Document name, used as the start of downloaded file names. */
  name: string;
  /** Template Markdown containing `{{field_key}}` placeholders. */
  body: string;
  /** The template's fields grouped into form sections (see groupFields). */
  sections: FieldSection[];
  /** The template's id: the AI chat about this document (the form is the fallback). */
  templateId: string;
  /** The draft to continue (a saved document, or a conversation handed over), or null for a blank one. */
  draft: StoredChat | null;
  /** Starts a blank draft of this template (the current one stays saved). */
  onNewDraft: () => void;
}

const REMARK_PLUGINS = [remarkGfm, remarkBreaks];

/**
 * AI chat (or form) + live preview of a filled-in template, with Markdown and PDF downloads. For an
 * account the draft autosaves to "My documents"; in demo mode it lives in this tab only.
 *
 * Only rendered for a signed-in user (RequireSession), so never during prerendering. DocumentLoader
 * keys it by draft, so starting a new draft mounts a fresh instance.
 */
export function DocumentBuilder({ name, body, sections, templateId, draft, onNewDraft }: DocumentBuilderProps) {
  const fields = useMemo(() => sections.flatMap((s) => s.fields), [sections]);
  const { user } = useSession();
  const router = useRouter();
  const storageKey = user ? chatStorageKey(user.email, templateId) : null;
  const [values, setValues] = useState<FieldValues>(() => ({ ...initialValues(fields), ...draft?.values }));
  const [messages, setMessages] = useState<ChatMessage[]>(() => draft?.messages ?? []);
  /** The conversation started on the home page (it keeps the home greeting). */
  const fromHome = draft?.fromHome ?? false;
  // The assistant needs the backend: on a static-only host (Vercel, next dev) fall back to the form.
  const availability = useChatAvailability();
  /** The user chose to fill in the form by hand instead of chatting. */
  const [manual, setManual] = useState(false);
  const editor = availability === "checking" ? "checking" : availability === "available" && !manual ? "chat" : "form";

  const markdown = useMemo(() => fillTemplate(body, fields, values), [body, fields, values]);
  const incomplete = incompleteFields(fields, values);
  const ready = incomplete.length === 0;
  // e.g. "Mutual-Non-Disclosure-Agreement_Acme-Inc_Globex-LLC": the document name plus the first two parties.
  const partyNames = sections.flatMap((s) => (s.nameKey ? [values[s.nameKey]] : [])).slice(0, 2);
  const filename = documentFilename(name, ...partyNames);

  const content: DocumentContent = { title: documentTitle(partyNames), values, messages };
  const [baseline] = useState<DocumentContent>(() =>
    draft?.docId !== undefined
      ? content
      : { title: documentTitle([]), values: initialValues(fields), messages: [] },
  );
  const autosave = useDocumentAutosave({
    enabled: user?.persisted === true,
    templateId,
    initialDocId: draft?.docId ?? null,
    content,
    baseline,
    // The address now names the document, so a reload or a bookmark reopens it.
    onCreated: (id) => window.history.replaceState(null, "", documentHref(templateId, id)),
  });
  const docId = autosave.docId ?? undefined;

  // Keep the conversation and the document for this tab too (it survives a reload before the first save).
  useEffect(() => {
    if (storageKey) saveChat(storageKey, { messages, values, fromHome, docId });
  }, [storageKey, messages, values, fromHome, docId]);

  const setValue = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }));

  const startOver = () => {
    setMessages([]);
    setValues(initialValues(fields));
  };

  // The AI switched to another document: save this one (with the AI's answer), then open the other,
  // which picks up the conversation and the carried-over values as a new draft.
  const openDocument = (nextId: string, conversation: ChatMessage[], carried: FieldValues) => {
    if (!user || !storageKey) return;
    saveChat(storageKey, { messages: conversation, values, fromHome, docId });
    const handoff = planHandoff(user.email, nextId, conversation, carried, fromHome);
    saveChat(handoff.key, handoff.chat);
    void autosave
      .saveNow({ ...content, messages: conversation })
      .catch(() => {}) // still switch: this tab keeps the conversation, and the next visit saves it
      .finally(() => router.push(handoff.href));
  };

  const downloadMarkdown = () => {
    const blob = new Blob([withDisclaimer(markdown)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
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
      <div className={editor === "chat" ? "lg:sticky lg:top-24 lg:self-start print:hidden" : "print:hidden"}>
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
            className="h-[32rem] lg:h-[calc(100vh-8rem)]"
          />
        )}
        {editor === "form" && (
          <>
            <p className="mb-4 rounded-lg border border-brand-blue/30 bg-brand-blue/5 px-4 py-3 text-sm text-stone-700">
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

      <section aria-label="Document preview" className="lg:sticky lg:top-24 lg:self-start">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <p className="text-stone-600" aria-live="polite">
              {ready ? (
                <span className="font-medium text-emerald-700">All fields complete</span>
              ) : (
                <span className="font-medium text-amber-700">
                  {incomplete.length} field{incomplete.length === 1 ? "" : "s"} to complete
                </span>
              )}
            </p>
            <SaveIndicator demo={!user?.persisted} status={autosave.status} saved={docId !== undefined} onRetry={autosave.retry} />
          </div>
          <div className="flex flex-wrap gap-2">
            {user?.persisted && (
              <button type="button" onClick={onNewDraft} className={buttonClass("ghost")}>
                New draft
              </button>
            )}
            <button type="button" onClick={downloadMarkdown} disabled={!ready} className={buttonClass("secondary")}>
              Download Markdown
            </button>
            <button type="button" onClick={downloadPdf} disabled={!ready} className={buttonClass("primary")}>
              Download PDF
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm lg:max-h-[calc(100vh-11rem)] lg:overflow-y-auto print:max-h-none print:overflow-visible print:rounded-none print:border-0 print:shadow-none">
          <Disclaimer className="m-5 mb-0 sm:m-8 sm:mb-0 print:m-0 print:mb-6" />
          <article
            className={
              "prose prose-stone max-w-none overflow-x-auto p-5 sm:p-8 " +
              "prose-headings:font-serif prose-headings:text-brand-navy prose-h1:text-center prose-h1:text-2xl prose-h2:text-lg " +
              "prose-code:rounded prose-code:bg-brand-yellow/25 prose-code:px-1 prose-code:py-0.5 prose-code:font-sans prose-code:font-medium prose-code:text-brand-navy " +
              "prose-code:before:content-none prose-code:after:content-none " +
              "print:overflow-visible print:p-0"
            }
          >
            <Markdown remarkPlugins={REMARK_PLUGINS}>{markdown}</Markdown>
          </article>
        </div>
      </section>
    </div>
  );
}
