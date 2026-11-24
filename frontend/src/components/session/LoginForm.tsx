"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api-client";
import { loginUser, saveSession, validateLogin, type LoginErrors } from "@/lib/session";
import { inputClass, labelClass } from "../input-styles";
import { useSession } from "./useSession";

interface TextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  error?: string;
}

function TextField({ id, label, error, ...input }: TextFieldProps) {
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <input
        id={id}
        className={inputClass}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...input}
      />
      {error && (
        <p id={errorId} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

/** Fake sign-in: name + email, no password. Brings the user into the app. */
export function LoginForm() {
  const { status } = useSession();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<LoginErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in (or just signed in): go to the app.
  useEffect(() => {
    if (status === "authenticated") router.replace("/");
  }, [status, router]);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);
    const result = validateLogin({ name, email });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      // On success the form stays busy until the effect above redirects.
      saveSession(await loginUser(result.value));
    } catch (error) {
      setFormError(
        error instanceof ApiError
          ? "Those details were not accepted. Check your name and email and try again."
          : "Could not sign in. Make sure your browser allows this site to store data.",
      );
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <TextField
        id="login-name"
        name="name"
        label="Name"
        autoComplete="name"
        placeholder="e.g. Jane Smith"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={errors.name}
      />
      <TextField
        id="login-email"
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        placeholder="e.g. jane@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={errors.email}
      />
      {formError && (
        <p role="alert" className="text-sm text-red-600">
          {formError}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-brand-purple px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-purple/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
