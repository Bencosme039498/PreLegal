import type { Metadata } from "next";
import { LoginForm } from "@/components/session/LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-sm py-12">
      <p className="text-sm font-semibold tracking-wide text-brand-blue uppercase">PreLegal</p>
      <h1 className="mt-1 font-serif text-3xl font-semibold text-brand-navy">Sign in</h1>
      <p className="mt-2 text-sm text-stone-600">
        Enter your name and email to start drafting. This is a demo sign-in: no password is needed.
      </p>
      <div className="mt-6 rounded-lg border border-stone-200 border-t-4 border-t-brand-yellow bg-white p-6 shadow-sm">
        <LoginForm />
      </div>
    </div>
  );
}
