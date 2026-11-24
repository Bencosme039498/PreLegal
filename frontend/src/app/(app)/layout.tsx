import { AppNav } from "@/components/session/AppNav";
import { RequireSession } from "@/components/session/RequireSession";

/** Pages that need a signed-in user. URLs are unchanged: (app) is a route group. */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <RequireSession>
      <AppNav />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8 print:max-w-none print:p-0">
        {children}
      </main>
    </RequireSession>
  );
}
