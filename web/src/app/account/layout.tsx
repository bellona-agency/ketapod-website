import type { Metadata } from "next";
import { AccountNav } from "@/components/account/AccountNav";

/**
 * The user panel's shell.
 *
 * `noindex` on the whole branch. These pages are behind a session and hold one
 * person's purchases, notes and children; there is nothing here a crawler
 * should hold and a good deal it should not. The public catalogue carries the
 * site's search traffic, and this branch is deliberately not part of it.
 */
export const metadata: Metadata = {
  title: "حساب کاربری",
  robots: { index: false, follow: false },
};

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="container-k py-10 sm:py-14">
      <div className="grid gap-8 lg:grid-cols-[232px_1fr] lg:gap-12">
        <AccountNav />
        {/* `min-w-0` so a long ledger row or an untruncated book title cannot
            push the grid column wider than its track and shove the nav
            off-screen — the classic RTL flex-overflow failure. */}
        <div className="min-w-0">{children}</div>
      </div>
    </main>
  );
}
