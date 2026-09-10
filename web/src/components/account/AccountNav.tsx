"use client";

import {
  Bell,
  BookHeart,
  Gift,
  Heart,
  LibraryBig,
  MonitorSmartphone,
  NotebookPen,
  Receipt,
  Settings,
  Sparkles,
  Target,
  TicketPercent,
  TrendingUp,
  UploadCloud,
  User,
  UserRoundCog,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/components/account/SessionProvider";
import { cn } from "@/lib/utils";

/**
 * The panel's sidebar.
 *
 * Grouped by what the person is trying to do rather than by which table backs
 * it: «شنیدن» is the product, «پول» is the commerce, «حساب» is the plumbing.
 * A flat list of fourteen items is a list nobody reads to the end of.
 *
 * On narrow screens it becomes a horizontally scrolling strip instead of a
 * drawer. A panel this deep needs its own navigation visible while you use it,
 * and a second hamburger inside a page reached through a hamburger is one menu
 * too many.
 */

interface Item {
  href: string;
  label: string;
  icon: React.ReactNode;
  /** Rendered as a count chip; used for unread notifications. */
  badge?: number;
}

export function AccountNav() {
  const pathname = usePathname() ?? "";
  const { me } = useSession();

  const groups: { title: string; items: Item[] }[] = [
    {
      title: "شنیدن",
      items: [
        { href: "/library", label: "کتابخانه", icon: <LibraryBig className="size-4" /> },
        { href: "/account/favourites", label: "علاقه‌مندی‌ها", icon: <Heart className="size-4" /> },
        {
          href: "/account/notes",
          label: "یادداشت‌ها و نشان‌ها",
          icon: <NotebookPen className="size-4" />,
        },
        { href: "/account/plan", label: "برنامه مطالعاتی", icon: <Target className="size-4" /> },
        { href: "/progress", label: "داشبورد یادگیری", icon: <TrendingUp className="size-4" /> },
      ],
    },
    {
      title: "پول",
      items: [
        { href: "/wallet", label: "کیف پول", icon: <Wallet className="size-4" /> },
        {
          href: "/account/subscription",
          label: "اشتراک",
          icon: <Sparkles className="size-4" />,
        },
        { href: "/account/orders", label: "خریدها و بازپرداخت", icon: <Receipt className="size-4" /> },
        { href: "/account/codes", label: "کد تخفیف و کارت هدیه", icon: <TicketPercent className="size-4" /> },
        { href: "/account/gifts", label: "هدیه دادن کتاب", icon: <Gift className="size-4" /> },
        { href: "/account/invite", label: "دعوت دوستان", icon: <BookHeart className="size-4" /> },
      ],
    },
    {
      title: "حساب",
      items: [
        { href: "/account", label: "نمای کلی", icon: <User className="size-4" /> },
        {
          href: "/account/notifications",
          label: "اعلان‌ها",
          icon: <Bell className="size-4" />,
          badge: me?.unreadNotifications || undefined,
        },
        { href: "/account/settings", label: "تنظیمات پخش", icon: <Settings className="size-4" /> },
        {
          href: "/account/devices",
          label: "دستگاه‌ها",
          icon: <MonitorSmartphone className="size-4" />,
        },
        { href: "/parent", label: "پنل والد", icon: <UserRoundCog className="size-4" /> },
        {
          href: "/account/narration",
          label: "ارسال PDF برای گویندگی",
          icon: <UploadCloud className="size-4" />,
        },
      ],
    },
  ];

  return (
    <nav aria-label="ناوبری حساب کاربری" className="lg:sticky lg:top-28 lg:self-start">
      {/* The mobile strip. `-mx-4 px-4` lets it bleed to the viewport edges so
          the last chip is visibly cut off rather than sitting flush — which is
          the only affordance telling a user there is more to scroll to. */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 lg:hidden">
        {groups.flatMap((g) => g.items).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(item.href, pathname) ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-[14px] font-medium transition-colors",
              isActive(item.href, pathname)
                ? "border-violet-200 bg-violet-50 text-violet"
                : "border-line bg-card text-muted",
            )}
          >
            <span aria-hidden>{item.icon}</span>
            {item.label}
            {item.badge ? <Chip n={item.badge} /> : null}
          </Link>
        ))}
      </div>

      <div className="hidden lg:block">
        {groups.map((group) => (
          <div key={group.title} className="mb-6">
            <p className="eyebrow px-3 text-faint">{group.title}</p>
            <ul className="mt-2 flex flex-col gap-0.5">
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={isActive(item.href, pathname) ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[15px] transition-colors",
                      isActive(item.href, pathname)
                        ? "bg-violet-50 font-bold text-violet"
                        : "text-muted hover:bg-paper-2 hover:text-ink",
                    )}
                  >
                    <span aria-hidden>{item.icon}</span>
                    <span className="flex-1">{item.label}</span>
                    {item.badge ? <Chip n={item.badge} /> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

function Chip({ n }: { n: number }) {
  return (
    <span className="tnum grid size-5 place-items-center rounded-full bg-violet text-[11px] font-bold text-white">
      {n}
    </span>
  );
}

/**
 * Exact match, not prefix match.
 *
 * `/account` is a prefix of every other item in this nav, so `startsWith` would
 * light «نمای کلی» up on all sixteen screens at once. Exact matching is also
 * simply correct here: none of these routes has children of its own.
 */
const isActive = (href: string, pathname: string) => pathname === href;
