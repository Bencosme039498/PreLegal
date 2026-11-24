/** "Complete" or "Draft" for a saved document. */
export function StatusBadge({ complete }: { complete: boolean }) {
  return complete ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-600/20 ring-inset">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-600" />
      Complete
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-600/20 ring-inset">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-amber-500" />
      Draft
    </span>
  );
}
