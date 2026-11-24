"use client";

import { useSession } from "./session/useSession";

/** The dashboard greeting, with the signed-in user's first name. */
export function Welcome() {
  const { user } = useSession();
  const firstName = user?.name.split(/\s+/)[0];
  return (
    <h1 className="font-serif text-3xl font-semibold text-brand-navy">
      {firstName ? `Welcome back, ${firstName}` : "Welcome"}
    </h1>
  );
}
