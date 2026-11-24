import { DISCLAIMER, DISCLAIMER_TITLE } from "@/lib/disclaimer";

/** Every page's footer: the draft / legal review notice. Hidden when printing (the PDF has its own). */
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-stone-200 bg-white print:hidden">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-4 py-6 text-xs text-stone-500 sm:flex-row sm:justify-between sm:px-6 lg:px-8">
        <p className="max-w-3xl">
          <strong className="font-semibold text-stone-700">{DISCLAIMER_TITLE}.</strong> {DISCLAIMER}
        </p>
        <p className="shrink-0">PreLegal · Templates from CommonPaper (CC BY 4.0)</p>
      </div>
    </footer>
  );
}
