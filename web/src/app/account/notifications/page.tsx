"use client";

import { Bell, BellOff, Gift, Loader2, Sparkles, Target, UserRoundCog } from "lucide-react";
import Link from "next/link";
import { useSession } from "@/components/account/SessionProvider";
import { useResource } from "@/hooks/useResource";
import { clearNotifications, getNotifications, markNotificationsRead } from "@/lib/platform";
import { cn, fmtAgo } from "@/lib/utils";

/**
 * The notification centre.
 *
 * Note what is absent: any control for routing a child's alerts anywhere. The
 * spec's fourth kids rule — «هیچ نوتیفیکیشنی به دستگاه کودک نرود --- همه به
 * گوشی والد» — is enforced in the schema rather than by a setting, so a kids
 * notification appears here, on the parent's account, and there is nowhere else
 * it could go.
 */

const ICONS = {
  renewal: <Sparkles className="size-4" />,
  kids: <UserRoundCog className="size-4" />,
  recap: <Bell className="size-4" />,
  gift: <Gift className="size-4" />,
  plan: <Target className="size-4" />,
  system: <Bell className="size-4" />,
} as const;

export default function NotificationsPage() {
  const { data, error, reload } = useResource(getNotifications, "/account/notifications");
  const { refresh } = useSession();

  async function markAll() {
    await markNotificationsRead({ all: true });
    reload();
    await refresh();
  }

  async function open(id: string, unread: boolean) {
    if (!unread) return;
    await markNotificationsRead({ id });
    reload();
    await refresh();
  }

  async function clear() {
    if (!window.confirm("همه‌ی اعلان‌ها پاک شوند؟")) return;
    await clearNotifications();
    reload();
    await refresh();
  }

  if (error) return <p className="py-20 text-center text-muted">{error}</p>;
  if (!data) {
    return <Loader2 className="mx-auto mt-16 size-6 animate-spin text-muted" aria-label="بارگیری" />;
  }

  return (
    <div>
      <span className="eyebrow text-muted">اعلان</span>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[27px] font-bold text-ink sm:text-[34px]">اعلان‌ها</h1>
        {data.items.length > 0 && (
          <div className="flex gap-2">
            {data.unread > 0 && (
              <button
                type="button"
                onClick={() => void markAll()}
                className="btn cursor-pointer rounded-lg border border-line bg-card px-4 py-2 text-[14px] font-medium text-muted transition-colors hover:text-ink"
              >
                خواندن همه
              </button>
            )}
            <button
              type="button"
              onClick={() => void clear()}
              className="btn cursor-pointer rounded-lg px-3 py-2 text-[14px] font-medium text-faint transition-colors hover:text-red-700"
            >
              پاک کردن
            </button>
          </div>
        )}
      </div>

      {data.items.length === 0 ? (
        <div className="card mt-8 p-10 text-center">
          <BellOff className="mx-auto size-8 text-faint" strokeWidth={1.4} aria-hidden />
          <p className="mt-4 text-[16px] text-muted">اعلانی ندارید.</p>
        </div>
      ) : (
        <ul className="mt-7 flex flex-col gap-2">
          {data.items.map((n) => {
            const unread = n.readAt === null;
            const body = (
              <>
                <span
                  className={cn(
                    "grid size-10 shrink-0 place-items-center rounded-full",
                    unread ? "bg-violet text-white" : "bg-paper-2 text-ink-2",
                  )}
                  aria-hidden
                >
                  {ICONS[n.kind]}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block text-[15px] leading-[1.6]",
                      unread ? "font-bold text-ink" : "text-ink-2",
                    )}
                  >
                    {n.title}
                  </span>
                  <span className="mt-0.5 block text-[14px] leading-[1.8] text-muted">
                    {n.body}
                  </span>
                  <span className="mt-1 block text-[12px] text-faint">
                    {fmtAgo(n.createdAt)}
                  </span>
                </span>
              </>
            );

            return (
              <li key={n.id}>
                {n.href ? (
                  <Link
                    href={n.href}
                    onClick={() => void open(n.id, unread)}
                    className={cn(
                      "flex gap-4 rounded-lg border p-5 transition-colors hover:border-violet-200",
                      unread ? "border-violet-100 bg-violet-50/40" : "border-line bg-card",
                    )}
                  >
                    {body}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => void open(n.id, unread)}
                    className={cn(
                      "flex w-full cursor-pointer gap-4 rounded-lg border p-5 text-right transition-colors",
                      unread ? "border-violet-100 bg-violet-50/40" : "border-line bg-card",
                    )}
                  >
                    {body}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
