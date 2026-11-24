/** Shared button styles, for <button> and <Link> alike (brand-purple marks the primary action). */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const base =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium shadow-sm transition-colors " +
  "focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2 focus-visible:outline-none " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-brand-purple text-white hover:bg-brand-purple/90",
  secondary: "border border-stone-300 bg-white text-stone-800 hover:bg-stone-50",
  ghost: "text-brand-blue shadow-none hover:bg-brand-blue/10",
  danger: "border border-red-200 bg-white text-red-700 hover:bg-red-50",
};

const sizes = { sm: "px-2.5 py-1.5 text-sm", md: "px-3.5 py-2 text-sm", lg: "px-4 py-2.5 text-base" };

export function buttonClass(variant: ButtonVariant = "secondary", size: keyof typeof sizes = "md"): string {
  return `${base} ${variants[variant]} ${sizes[size]}`;
}

/** A white panel: the app's card surface. */
export const cardClass = "rounded-xl border border-stone-200 bg-white shadow-sm";
