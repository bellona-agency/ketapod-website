"use client";

import { Clock, Gift, Play, Sparkles, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CoverArt } from "@/components/primitives/CoverArt";
import { coverIndex, formatDuration } from "@/lib/catalog";
import { ApiError, getLibrary, getMe, type LibraryItem, type Me } from "@/lib/platform";
import { routes } from "@/lib/routes";

/**
 * The listener's shelf — the first screen of the authenticated product.
 *
 * Reads the shelf from entitlements, so a gift, a subscription title and a
 * purchase all appear without this component knowing the difference. The badge
 * that says which is which comes from the server's `source` field rather than
 * from anything inferred here.
 */
export default function LibraryPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [resume, setResume] = useState<LibraryItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [profile, library] = await Promise.all([getMe(), getLibrary()]);
        if (cancelled) return;
        setMe(profile);
        setItems(library.items);
        setResume(library.continueListening);
      } catch (err) {
        /* A 401 here is the ordinary logged-out case, not an error worth
           showing. The proxy already redirects most visitors; this catches the
           session that expired while the tab was open. */
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login?next=/library");
          return;
        }
        if (!cancelled) setItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (items === null) {
    return (
      <main className="container-k py-16">
        <div className="h-8 w-40 animate-pulse rounded-lg bg-paper-2" />
        <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-lg bg-paper-2" />
          ))}
        </div>
      </main>
    );
  }

  return (
    <main className="container-k py-12 sm:py-16">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="eyebrow text-muted">کتابخانه</span>
          <h1 className="mt-2 text-[27px] font-bold text-ink sm:text-[34px]">
            {me?.name ? `${me.name} عزیز` : "قفسه شما"}
          </h1>
        </div>
        <Link
          href="/wallet"
          className="chip chip-paper inline-flex h-11 w-auto items-center gap-2 px-4 text-[15px] font-medium"
        >
          <Wallet className="size-4" strokeWidth={1.7} aria-hidden />
          <span className="tnum">
            {me ? `${Math.round(me.walletBalanceRial / 10).toLocaleString("fa-IR")} تومان` : "—"}
          </span>
        </Link>
      </header>

      {resume && (
        <section className="mt-8">
          <h2 className="text-[15px] font-bold text-muted">ادامه شنیدن</h2>
          <Link
            href={routes.book(resume.bookSlug)}
            className="group lift mt-3 flex items-center gap-4 rounded-lg border border-line bg-card p-4 shadow-e1 transition-[border-color,box-shadow] hover:border-violet-200 sm:p-5"
          >
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-violet text-white">
              <Play className="size-5 translate-x-px" fill="currentColor" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[17px] font-bold text-ink">
                {resume.title}
              </span>
              <span className="tnum mt-1 block text-[14px] text-muted">
                {formatDuration(resume.positionSec)} از {formatDuration(resume.durationSec)}
              </span>
              <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-paper-2">
                <span
                  className="block h-full rounded-full bg-violet"
                  style={{ width: `${Math.round(resume.progress * 100)}%` }}
                />
              </span>
            </span>
          </Link>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-[15px] font-bold text-muted">
          همه عنوان‌ها <span className="tnum">({items.length})</span>
        </h2>

        {items.length === 0 ? (
          <div className="card mt-4 flex flex-col items-center gap-4 p-10 text-center">
            <p className="text-[16px] leading-[1.85] text-muted">
              هنوز چیزی در قفسه‌تان نیست.
            </p>
            <Link
              href={routes.books()}
              className="btn inline-flex h-11 items-center rounded-lg bg-violet px-5 text-[15px] font-bold text-white"
            >
              دیدن کتاب‌ها
            </Link>
          </div>
        ) : (
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <li key={item.entitlementId}>
                <Link
                  href={routes.book(item.bookSlug)}
                  className="group lift flex h-full gap-4 rounded-lg border border-line bg-card p-4 shadow-e1 transition-[border-color,box-shadow] hover:border-violet-200"
                >
                  <CoverArt
                    alt=""
                    index={coverIndex(item.bookSlug)}
                    sizes="64px"
                    className="aspect-[2/3] w-16 shrink-0"
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[16px] font-bold text-ink">
                      {item.title}
                    </span>
                    <span className="mt-1 truncate text-[14px] text-muted">
                      {item.voice?.name ?? "—"}
                      {item.narratorType === "ai" && " · هوش مصنوعی"}
                    </span>

                    <span className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
                      <SourceBadge source={item.source} expired={item.expired} />
                      <span className="tnum text-[12px] text-faint">
                        {formatDuration(item.durationSec)}
                      </span>
                    </span>

                    {item.progress > 0 && (
                      <span className="mt-2 block h-1 overflow-hidden rounded-full bg-paper-2">
                        <span
                          className="block h-full rounded-full bg-violet"
                          style={{ width: `${Math.round(item.progress * 100)}%` }}
                        />
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

/**
 * Where the access came from.
 *
 * Worth showing rather than hiding: a subscription title disappearing when the
 * subscription lapses is only fair if the shelf said all along that it was on
 * loan. Expired rows stay visible and say so.
 */
function SourceBadge({
  source,
  expired,
}: {
  source: LibraryItem["source"];
  expired: boolean;
}) {
  if (expired) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[12px] font-medium text-red-700">
        <Clock className="size-3" strokeWidth={2} aria-hidden />
        منقضی شده
      </span>
    );
  }

  const MAP = {
    purchase: { label: "خریداری‌شده", icon: null },
    gift: { label: "هدیه", icon: Gift },
    subscription: { label: "اشتراک", icon: Sparkles },
    org: { label: "سازمانی", icon: null },
    promo: { label: "هدیه", icon: Gift },
  } as const;

  const { label, icon: Icon } = MAP[source];
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-paper-2 px-2 py-0.5 text-[12px] font-medium text-ink-2">
      {Icon && <Icon className="size-3" strokeWidth={2} aria-hidden />}
      {label}
    </span>
  );
}
