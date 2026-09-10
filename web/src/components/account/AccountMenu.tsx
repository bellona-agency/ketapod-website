"use client";

import {
  Bell,
  Heart,
  LogOut,
  NotebookPen,
  Sparkles,
  Target,
  User,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useSession } from "@/components/account/SessionProvider";
import { fmtToman } from "@/lib/utils";
import type { Me } from "@/lib/platform";

/**
 * The signed-in corner of the header.
 *
 * A disclosure rather than a hover menu: on a touch screen hover does not exist
 * and the first tap would open a menu the second tap immediately navigates
 * through. Click to open, Escape or an outside click to close — and focus is
 * not trapped, because this is a menu the user can simply tab past.
 */
export function AccountMenu({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const { signOut } = useSession();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initial = (me.name ?? me.phone).trim().charAt(0);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={menuId}
        className="relative grid size-12 cursor-pointer place-items-center rounded-full border border-line bg-card/70 text-[17px] font-bold text-ink transition-colors hover:border-violet-200"
        aria-label="حساب کاربری"
      >
        {initial}
        {me.unreadNotifications > 0 && (
          <span
            className="absolute -top-0.5 -left-0.5 grid size-5 place-items-center rounded-full bg-violet text-[11px] font-bold text-white"
            /* Announced as text, because a red dot is invisible to a screen
               reader and "۳" alone is not a sentence. */
            aria-label={`${me.unreadNotifications} اعلان خوانده‌نشده`}
          >
            <span className="tnum" aria-hidden>
              {me.unreadNotifications}
            </span>
          </span>
        )}
      </button>

      {open && (
        <div
          id={menuId}
          className="absolute left-0 top-[calc(100%+8px)] z-50 w-[272px] overflow-hidden rounded-xl border border-line bg-card shadow-e4"
        >
          <div className="border-b border-line px-4 py-3.5">
            <p className="truncate text-[16px] font-bold text-ink">
              {me.name ?? "بدون نام"}
            </p>
            <p className="tnum mt-0.5 text-[13px] text-muted">{me.phone}</p>
            <p className="tnum mt-2 text-[14px] font-medium text-ink">
              {fmtToman(me.walletBalanceRial)}
            </p>
            {me.subscription && (
              <p className="mt-1 text-[12px] text-violet">
                اشتراک {me.subscription.tierName} — {me.subscription.daysLeft} روز مانده
              </p>
            )}
          </div>

          <nav className="p-1.5" onClick={() => setOpen(false)}>
            <Item href="/account" icon={<User className="size-4" />} label="حساب کاربری" />
            <Item
              href="/account/notifications"
              icon={<Bell className="size-4" />}
              label="اعلان‌ها"
              badge={me.unreadNotifications || undefined}
            />
            <Item href="/wallet" icon={<Wallet className="size-4" />} label="کیف پول" />
            <Item
              href="/account/favourites"
              icon={<Heart className="size-4" />}
              label="علاقه‌مندی‌ها"
            />
            <Item
              href="/account/notes"
              icon={<NotebookPen className="size-4" />}
              label="یادداشت‌ها و نشان‌ها"
            />
            <Item href="/account/plan" icon={<Target className="size-4" />} label="برنامه مطالعاتی" />
            <Item
              href="/account/subscription"
              icon={<Sparkles className="size-4" />}
              label="اشتراک"
            />
          </nav>

          <div className="border-t border-line p-1.5">
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2.5 text-right text-[15px] text-muted transition-colors hover:bg-paper-2 hover:text-ink"
            >
              <LogOut className="size-4" strokeWidth={1.8} aria-hidden />
              خروج از حساب
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Item({
  href,
  icon,
  label,
  badge,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2.5 rounded-md px-3 py-2.5 text-[15px] text-ink transition-colors hover:bg-paper-2"
    >
      <span className="text-muted" aria-hidden>
        {icon}
      </span>
      <span className="flex-1">{label}</span>
      {badge !== undefined && (
        <span className="tnum grid size-5 place-items-center rounded-full bg-violet-50 text-[11px] font-bold text-violet">
          {badge}
        </span>
      )}
    </Link>
  );
}
