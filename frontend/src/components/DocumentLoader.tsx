"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ApiError } from "@/lib/api-client";
import { chatStorageKey, clearChat, loadChat, saveChat, templatePath, type StoredChat } from "@/lib/chat";
import { documentHref, getDocument, parseDocId } from "@/lib/documents";
import type { FieldSection } from "@/lib/fill-template";
import { DocumentBuilder } from "./DocumentBuilder";
import { useSession } from "./session/useSession";
import { buttonClass, cardClass } from "./ui/button";

interface DocumentLoaderProps {
  name: string;
  body: string;
  sections: FieldSection[];
  templateId: string;
}

type Loaded =
  | { state: "loading" }
  | { state: "ready"; draft: StoredChat | null }
  | { state: "not_found" }
  | { state: "error" };

/**
 * Decides which draft a template page edits, then renders the builder for it:
 * - `?doc=<id>`: that saved document (this tab's copy if it has one, which is the freshest);
 * - no `?doc`: a new draft, or one handed over by the AI that hasn't been saved yet (home chat or
 *   a document switch), kept in this tab's sessionStorage until its first save.
 * Rendered only for a signed-in user (RequireSession), so it may read the URL and sessionStorage.
 */
export function DocumentLoader(props: DocumentLoaderProps) {
  const { templateId, sections } = props;
  const { user } = useSession();
  const router = useRouter();
  const fieldKeys = useMemo(() => sections.flatMap((s) => s.fields.map((f) => f.key)), [sections]);
  const storageKey = user ? chatStorageKey(user.email, templateId) : null;
  const [requested] = useState(() => parseDocId(window.location.search));
  const [loaded, setLoaded] = useState<Loaded>(() => {
    const stored = storageKey ? loadChat(storageKey, fieldKeys) : null;
    if (!user?.persisted) return { state: "ready", draft: stored };
    if (requested === null) {
      // A stored chat with a docId belongs to a saved document: this is a new draft.
      if (stored?.docId !== undefined && storageKey) clearChat(storageKey);
      return { state: "ready", draft: stored?.docId === undefined ? stored : null };
    }
    return stored?.docId === requested ? { state: "ready", draft: stored } : { state: "loading" };
  });

  /** Bumped by "New draft", so the builder starts again from a fresh instance. */
  const [draftKey, setDraftKey] = useState(0);

  const loading = loaded.state === "loading";
  useEffect(() => {
    if (!loading || requested === null || !storageKey) return;
    let active = true;
    getDocument(requested)
      .then((doc) => {
        if (!active) return;
        if (doc.template_id !== templateId) {
          router.replace(documentHref(doc.template_id, doc.id));
          return;
        }
        const draft: StoredChat = { messages: doc.messages, values: doc.values, docId: doc.id };
        saveChat(storageKey, draft);
        setLoaded({ state: "ready", draft });
      })
      .catch((error: unknown) => {
        if (active) setLoaded({ state: error instanceof ApiError && error.status === 404 ? "not_found" : "error" });
      });
    return () => {
      active = false;
    };
  }, [loading, requested, storageKey, templateId, router]);

  /** "New draft": a blank document on this page (the current one stays saved). */
  const startNew = () => {
    if (storageKey) clearChat(storageKey);
    window.history.replaceState(null, "", templatePath(templateId));
    setLoaded({ state: "ready", draft: null });
    setDraftKey((key) => key + 1);
  };

  if (loaded.state === "loading") {
    return (
      <p role="status" className="py-16 text-center text-sm text-stone-500">
        Opening your document…
      </p>
    );
  }
  if (loaded.state !== "ready") {
    return (
      <div className={`${cardClass} mx-auto max-w-lg p-8 text-center`}>
        <h2 className="font-serif text-xl font-semibold text-brand-navy">
          {loaded.state === "not_found" ? "Document not found" : "Couldn't open this document"}
        </h2>
        <p className="mt-2 text-sm text-stone-600">
          {loaded.state === "not_found"
            ? "It may have been deleted, or the link belongs to another account."
            : "Check your connection and try again."}
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href="/documents/" className={buttonClass("secondary")}>
            My documents
          </Link>
          <button type="button" onClick={startNew} className={buttonClass("primary")}>
            Start a new draft
          </button>
        </div>
      </div>
    );
  }
  return <DocumentBuilder key={draftKey} {...props} draft={loaded.draft} onNewDraft={startNew} />;
}
