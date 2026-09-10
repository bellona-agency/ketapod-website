import { AppShell } from "@/components/AppShell";

/** Everything under this group requires a session; AppShell renders
    nothing until AuthProvider has one, and AuthProvider redirects when
    it cannot get one. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
