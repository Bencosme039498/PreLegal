import { RequireSession } from "@/components/session/RequireSession";
import { UserBar } from "@/components/session/UserBar";

/** Pages that need a (fake) signed-in user. URLs are unchanged: (app) is a route group. */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <RequireSession>
      <UserBar />
      {children}
    </RequireSession>
  );
}
