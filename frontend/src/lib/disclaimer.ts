// The PL-9 notice: generated documents are drafts that need a lawyer's review. Shown above the preview,
// printed with the PDF, written at the top of the Markdown download, and in the footer and sign-up page.

export const DISCLAIMER_TITLE = "Draft for legal review";

export const DISCLAIMER =
  "This document was generated from a template and should be considered a draft. It is not legal advice " +
  "and is subject to review by a qualified attorney before it is signed or relied on.";

/** The Markdown download: the document with the disclaimer as a quote at the top. */
export function withDisclaimer(markdown: string): string {
  return `> **${DISCLAIMER_TITLE}.** ${DISCLAIMER}\n\n${markdown}`;
}
