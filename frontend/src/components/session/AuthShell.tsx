import Link from "next/link";

const POINTS = [
  "Describe what you need: the AI assistant picks the right agreement.",
  "Answer a few questions and watch the document fill itself in.",
  "Every draft is saved to your account, ready to pick up later.",
];

/** Sign-in and sign-up pages: a product panel beside the form card. */
export function AuthShell({
  title,
  subtitle,
  footer,
  children,
}: {
  title: string;
  subtitle: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="flex flex-1 items-stretch">
      <section className="relative hidden w-[44%] flex-col justify-between overflow-hidden bg-brand-navy p-10 text-white lg:flex">
        <Link href="/login/" className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-lg bg-brand-yellow font-serif text-xl font-bold text-brand-navy"
          >
            P
          </span>
          <span className="font-serif text-xl font-semibold">PreLegal</span>
        </Link>
        <div>
          <h2 className="font-serif text-3xl leading-tight font-semibold">
            Legal agreements, drafted in a conversation.
          </h2>
          <ul className="mt-8 space-y-4 text-sm text-white/85">
            {POINTS.map((point) => (
              <li key={point} className="flex gap-3">
                <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-yellow" />
                {point}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-white/60">NDAs, service agreements, promissory notes and more.</p>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -bottom-24 size-72 rounded-full bg-brand-blue/20 blur-2xl"
        />
      </section>

      <section className="flex flex-1 items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-md">
          <p className="font-serif text-lg font-semibold text-brand-navy lg:hidden">PreLegal</p>
          <h1 className="mt-1 font-serif text-3xl font-semibold text-brand-navy">{title}</h1>
          <p className="mt-2 text-sm text-stone-600">{subtitle}</p>
          <div className="mt-8 rounded-xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8">{children}</div>
          {footer && <div className="mt-6">{footer}</div>}
        </div>
      </section>
    </main>
  );
}
