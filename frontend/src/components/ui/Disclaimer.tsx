import { DISCLAIMER, DISCLAIMER_TITLE } from "@/lib/disclaimer";

/**
 * "Draft for legal review" notice. Printed with the document (the PDF download), so it isn't
 * print:hidden; `compact` is the one-line version for forms.
 */
export function Disclaimer({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  return (
    <aside
      role="note"
      aria-label={DISCLAIMER_TITLE}
      className={
        `rounded-lg border border-brand-yellow/60 bg-brand-yellow/10 text-stone-700 print:border-stone-400 print:bg-white ` +
        `${compact ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm"} ${className}`
      }
    >
      <strong className="font-semibold text-brand-navy">{DISCLAIMER_TITLE}.</strong> {DISCLAIMER}
    </aside>
  );
}
