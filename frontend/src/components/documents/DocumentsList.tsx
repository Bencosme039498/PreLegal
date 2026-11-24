"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  deleteDocument,
  documentHref,
  formatUpdatedAt,
  listDocuments,
  type DocumentSummary,
} from "@/lib/documents";
import { useSession } from "../session/useSession";
import { StatusBadge } from "../ui/StatusBadge";
import { buttonClass, cardClass } from "../ui/button";

interface DocumentsListProps {
  /** Template id -> name, from the catalog (read at build time by the page). */
  templateNames: Record<string, string>;
  /** Show only the most recent documents, with a link to all of them (the dashboard). */
  limit?: number;
}

type ListState =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; documents: DocumentSummary[] };

/** The signed-in user's saved documents, most recently edited first, to reopen or delete. */
export function DocumentsList({ templateNames, limit }: DocumentsListProps) {
  const { user } = useSession();
  const [list, setList] = useState<ListState>({ state: "loading" });
  const [confirming, setConfirming] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [deleteFailed, setDeleteFailed] = useState(false);

  const fetchList = useCallback(
    () =>
      listDocuments()
        .then((documents) => setList({ state: "ready", documents }))
        .catch(() => setList({ state: "error" })),
    [],
  );

  useEffect(() => {
    if (user?.persisted) void fetchList();
  }, [user?.persisted, fetchList]);

  const load = () => {
    setList({ state: "loading" });
    void fetchList();
  };

  if (!user?.persisted) {
    return (
      <div className={`${cardClass} p-8 text-center text-sm text-stone-600`}>
        <p className="font-medium text-brand-navy">Saved documents need an account.</p>
        <p className="mt-1">In demo mode nothing is saved: each draft stays in this browser tab.</p>
      </div>
    );
  }

  const remove = async (id: number) => {
    setDeleting(id);
    setDeleteFailed(false);
    try {
      await deleteDocument(id);
      setList((prev) =>
        prev.state === "ready" ? { state: "ready", documents: prev.documents.filter((d) => d.id !== id) } : prev,
      );
    } catch {
      setDeleteFailed(true);
    } finally {
      setDeleting(null);
      setConfirming(null);
    }
  };

  if (list.state === "loading") {
    return (
      <div className={`${cardClass} p-8 text-center text-sm text-stone-500`} role="status">
        Loading your documents…
      </div>
    );
  }
  if (list.state === "error") {
    return (
      <div role="alert" className={`${cardClass} p-8 text-center text-sm text-stone-600`}>
        <p>Couldn&apos;t load your documents.</p>
        <button type="button" onClick={load} className={`${buttonClass("secondary", "sm")} mt-3`}>
          Try again
        </button>
      </div>
    );
  }

  const shown = limit ? list.documents.slice(0, limit) : list.documents;
  if (shown.length === 0) {
    return (
      <div className={`${cardClass} border-dashed p-8 text-center`}>
        <p className="font-medium text-brand-navy">No documents yet</p>
        <p className="mt-1 text-sm text-stone-600">
          Start a draft with the assistant or pick a template: it&apos;s saved here automatically.
        </p>
        {!limit && (
          <Link href="/" className={`${buttonClass("primary")} mt-4`}>
            Start a document
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className={`${cardClass} overflow-hidden`}>
      {deleteFailed && (
        <p role="alert" className="border-b border-red-100 bg-red-50 px-5 py-2 text-sm text-red-700">
          Couldn&apos;t delete that document. Try again.
        </p>
      )}
      <ul className="divide-y divide-stone-100">
        {shown.map((doc) => {
          const templateName = templateNames[doc.template_id] ?? doc.template_id;
          return (
            <li key={doc.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 hover:bg-stone-50/60">
              <div className="min-w-0 flex-1">
                <Link
                  href={documentHref(doc.template_id, doc.id)}
                  className="block truncate font-medium text-brand-navy hover:text-brand-blue"
                >
                  {doc.title}
                </Link>
                <p className="mt-0.5 truncate text-sm text-stone-500">
                  {doc.title === templateName ? "" : `${templateName} · `}Edited {formatUpdatedAt(doc.updated_at)}
                </p>
              </div>
              <StatusBadge complete={doc.complete} />
              <div className="flex items-center gap-2">
                <Link href={documentHref(doc.template_id, doc.id)} className={buttonClass("secondary", "sm")}>
                  Open
                </Link>
                {!limit &&
                  (confirming === doc.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void remove(doc.id)}
                        disabled={deleting === doc.id}
                        className={buttonClass("danger", "sm")}
                      >
                        {deleting === doc.id ? "Deleting…" : "Confirm delete"}
                      </button>
                      <button type="button" onClick={() => setConfirming(null)} className={buttonClass("ghost", "sm")}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirming(doc.id)}
                      aria-label={`Delete ${doc.title}`}
                      className={buttonClass("ghost", "sm")}
                    >
                      Delete
                    </button>
                  ))}
              </div>
            </li>
          );
        })}
      </ul>
      {limit && list.documents.length > limit && (
        <Link
          href="/documents/"
          className="block border-t border-stone-100 px-5 py-3 text-sm font-medium text-brand-blue hover:bg-stone-50"
        >
          View all {list.documents.length} documents <span aria-hidden="true">→</span>
        </Link>
      )}
    </div>
  );
}
