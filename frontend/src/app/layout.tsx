import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "PreLegal: draft legal agreements", template: "%s | PreLegal" },
  description: "Fill in key details to generate a legal agreement and download it as PDF or Markdown.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8 print:max-w-none print:p-0">
          {children}
        </main>
        <footer className="mx-auto w-full max-w-7xl px-4 pb-8 sm:px-6 lg:px-8 print:hidden">
          <p className="border-t border-stone-200 pt-4 text-xs text-stone-500">
            These templates are general-purpose starting points and are <strong>not legal advice</strong>. They have
            not been tailored to any jurisdiction; have a qualified attorney review a document before use.
          </p>
        </footer>
      </body>
    </html>
  );
}
