import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteFooter } from "@/components/SiteFooter";
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
  description:
    "Draft legal agreements with an AI assistant, keep every draft in one place, and download them as PDF or Markdown.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Each layout renders its own <main>: the app pages under the top bar, sign-in pages centred. */}
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
