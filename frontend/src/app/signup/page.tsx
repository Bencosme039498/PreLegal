import type { Metadata } from "next";
import { AuthShell } from "@/components/session/AuthShell";
import { AuthForm } from "@/components/session/AuthForm";
import { Disclaimer } from "@/components/ui/Disclaimer";

export const metadata: Metadata = { title: "Create an account" };

export default function SignUpPage() {
  return (
    <AuthShell
      title="Create your account"
      subtitle="Draft agreements with the AI assistant and keep every document in one place."
      footer={<Disclaimer compact />}
    >
      <AuthForm mode="signup" />
    </AuthShell>
  );
}
