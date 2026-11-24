import type { Metadata } from "next";
import { AuthShell } from "@/components/session/AuthShell";
import { AuthForm } from "@/components/session/AuthForm";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <AuthShell title="Welcome back" subtitle="Sign in to continue drafting and to find your saved documents.">
      <AuthForm mode="signin" />
    </AuthShell>
  );
}
