"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api-client";
import { createAutosaver, type Autosaver, type SaveStatus } from "@/lib/autosave";
import { createDocument, updateDocument, type DocumentContent } from "@/lib/documents";

interface Options {
  /** False in demo mode (no account): nothing is saved. */
  enabled: boolean;
  templateId: string;
  /** The saved document being edited, or null for a draft that hasn't been saved yet. */
  initialDocId: number | null;
  /** The draft as it is now. */
  content: DocumentContent;
  /** The draft as last saved (or blank): unchanged content isn't saved, so opening a document
   * doesn't bump its "last edited" time and visiting a template doesn't create an empty draft. */
  baseline: DocumentContent;
  /** The first save created the document. */
  onCreated: (id: number) => void;
}

export interface DocumentAutosave {
  status: SaveStatus;
  docId: number | null;
  /** Saves `content` now (after any save in flight), e.g. before leaving for another document. */
  saveNow: (content: DocumentContent) => Promise<void>;
  retry: () => void;
}

/**
 * Autosaves a draft about a second after each change: the first save creates the document, later ones
 * replace it. Saves run one at a time, and anything unsaved is saved when the tab is hidden or the
 * page is left.
 */
export function useDocumentAutosave({
  enabled,
  templateId,
  initialDocId,
  content,
  baseline,
  onCreated,
}: Options): DocumentAutosave {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [docId, setDocId] = useState(initialDocId);
  // The ref is what saves read (they outlive renders); the state re-renders the page once it exists.
  const docIdRef = useRef(initialDocId);
  const onCreatedRef = useRef(onCreated);
  const lastScheduled = useRef(JSON.stringify(baseline));

  useEffect(() => {
    onCreatedRef.current = onCreated;
  });

  // Created on first use (in an effect or a handler), never during render.
  const autosaverRef = useRef<Autosaver<DocumentContent> | null>(null);
  const getAutosaver = () =>
    (autosaverRef.current ??= createAutosaver<DocumentContent>({
      onStatus: setStatus,
      save: async (snapshot) => {
        const id = docIdRef.current;
        if (id === null) {
          const created = await createDocument(templateId, snapshot);
          docIdRef.current = created.id;
          setDocId(created.id);
          onCreatedRef.current(created.id);
          return;
        }
        try {
          await updateDocument(id, snapshot);
        } catch (error) {
          // Deleted meanwhile (e.g. in another tab): the retry saves it as a new document.
          if (error instanceof ApiError && error.status === 404) docIdRef.current = null;
          throw error;
        }
      },
    }));

  const json = JSON.stringify(content);
  useEffect(() => {
    if (!enabled || json === lastScheduled.current) return;
    lastScheduled.current = json;
    getAutosaver().schedule(JSON.parse(json) as DocumentContent);
    // getAutosaver only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, json]);

  // Save what's pending when the tab is hidden (it may be closed next) and when leaving the page.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void autosaverRef.current?.flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      const autosaver = autosaverRef.current;
      if (autosaver?.hasUnsaved()) void autosaver.flush();
      autosaver?.dispose();
    };
  }, []);

  return {
    status,
    docId,
    saveNow: async (snapshot) => {
      if (!enabled) return;
      lastScheduled.current = JSON.stringify(snapshot);
      const autosaver = getAutosaver();
      autosaver.schedule(snapshot);
      await autosaver.flush();
    },
    retry: () => void autosaverRef.current?.flush(),
  };
}
