"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  PASSWORD_MIN,
  authErrorMessage,
  demoUser,
  saveSession,
  signIn,
  signUp,
  validateDemo,
  validateSignIn,
  validateSignUp,
  type SessionUser,
  type Validation,
} from "@/lib/session";
import { buttonClass } from "../ui/button";
import { TextField } from "../ui/TextField";
import { useChatAvailability } from "../useChatAvailability";
import { useSession } from "./useSession";

export type AuthMode = "signin" | "signup";

type Fields = { name: string; email: string; password: string };
type Errors = Partial<Record<keyof Fields, string>>;

type Checked = { ok: true; submit: () => Promise<SessionUser> | SessionUser } | { ok: false; errors: Errors };

/** Validates the form for one mode and, when valid, returns the request that signs the user in. */
function flow<T>(validate: (fields: Fields) => Validation<T>, run: (value: T) => Promise<SessionUser> | SessionUser) {
  return {
    validate: (fields: Fields): Checked => {
      const v = validate(fields);
      return v.ok ? { ok: true, submit: () => run(v.value) } : { ok: false, errors: v.errors };
    },
  };
}

const flows = {
  signin: flow(validateSignIn, signIn),
  signup: flow(validateSignUp, signUp),
  demo: flow(validateDemo, demoUser),
};

const COPY = {
  signin: { submit: "Sign in", busy: "Signing in…" },
  signup: { submit: "Create account", busy: "Creating your account…" },
  demo: { submit: "Try the demo", busy: "Starting…" },
};

/**
 * Sign in or create an account, then go to the dashboard. Without a backend (static hosting) there
 * are no accounts, so it offers a demo sign-in that stays on this device instead.
 */
export function AuthForm({ mode }: { mode: AuthMode }) {
  const { status } = useSession();
  const router = useRouter();
  const availability = useChatAvailability();
  const demo = availability === "unavailable";
  const [fields, setFields] = useState<Fields>({ name: "", email: "", password: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in (or just signed in): go to the app.
  useEffect(() => {
    if (status === "authenticated") router.replace("/");
  }, [status, router]);

  const set = (key: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields((prev) => ({ ...prev, [key]: e.target.value }));

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);
    // Validate like the backend does, then make the request for this mode.
    const flow = demo ? flows.demo : flows[mode];
    const checked = flow.validate(fields);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    setBusy(true);
    try {
      // On success the form stays busy until the effect above redirects.
      saveSession(await checked.submit());
    } catch (error) {
      setFormError(authErrorMessage(error));
      setBusy(false);
    }
  };

  if (availability === "checking") {
    return (
      <p role="status" className="py-8 text-center text-sm text-stone-500">
        Loading…
      </p>
    );
  }

  const copy = COPY[demo ? "demo" : mode];
  const askName = demo || mode === "signup";
  return (
    <>
      {demo && (
        <p className="mb-5 rounded-lg border border-brand-blue/30 bg-brand-blue/5 px-3 py-2 text-sm text-stone-700">
          <strong className="font-semibold text-brand-navy">Demo mode.</strong> Accounts need the PreLegal server,
          which isn&apos;t running here. Enter a name and email to try the form-based editor: nothing is saved
          and it stays on this device.
        </p>
      )}
      <form onSubmit={submit} noValidate className="space-y-4">
        {askName && (
          <TextField
            id="auth-name"
            name="name"
            label="Full name"
            autoComplete="name"
            placeholder="Jane Smith"
            value={fields.name}
            onChange={set("name")}
            error={errors.name}
          />
        )}
        <TextField
          id="auth-email"
          name="email"
          type="email"
          label="Work email"
          autoComplete="email"
          placeholder="jane@company.com"
          value={fields.email}
          onChange={set("email")}
          error={errors.email}
        />
        {!demo && (
          <TextField
            id="auth-password"
            name="password"
            type="password"
            label="Password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            hint={mode === "signup" ? `At least ${PASSWORD_MIN} characters.` : undefined}
            value={fields.password}
            onChange={set("password")}
            error={errors.password}
          />
        )}
        {formError && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {formError}
          </p>
        )}
        <button type="submit" disabled={busy} className={`${buttonClass("primary", "lg")} w-full`}>
          {busy ? copy.busy : copy.submit}
        </button>
      </form>
      {!demo && (
        <p className="mt-6 text-center text-sm text-stone-600">
          {mode === "signin" ? (
            <>
              New to PreLegal?{" "}
              <Link href="/signup/" className="font-medium text-brand-blue hover:text-brand-blue/80">
                Create an account
              </Link>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <Link href="/login/" className="font-medium text-brand-blue hover:text-brand-blue/80">
                Sign in
              </Link>
            </>
          )}
        </p>
      )}
    </>
  );
}
