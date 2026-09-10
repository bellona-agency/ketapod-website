"use client";

import { Heart, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { CoverArt } from "@/components/primitives/CoverArt";
import { useResource } from "@/hooks/useResource";
import { getFavourites, removeFavourite } from "@/lib/platform";
import { fmtToman } from "@/lib/utils";

/**
 * علاقه‌مندی — the wish list.
 *
 * Saved by *book*, not by edition, because hearting «بوف کور» is saving the
 * work; whose voice to hear it in is a decision made later, on the book page,
 * with all the performances in front of you. The card therefore links to the
 * book rather than offering a buy button for an edition nobody chose.
 */
export default function FavouritesPage() {
  const { data, error, reload } = useResource(getFavourites, "/account/favourites");
  const [busy, setBusy] = useState<string | null>(null);

  async function remove(slug: string) {
    setBusy(slug);
    try {
      await removeFavourite(slug);
      reload();
    } finally {
      setBusy(null);
    }
  }

  if (error) return <p className="py-20 text-center text-muted">{error}</p>;
  if (!data) {
    return <Loader2 className="mx-auto mt-16 size-6 animate-spin text-muted" aria-label="بارگیری" />;
  }

  return (
    <div>
      <span className="eyebrow text-muted">فهرست</span>
      <h1 className="mt-2 text-[27px] font-bold text-ink sm:text-[34px]">علاقه‌مندی‌ها</h1>

      {data.items.length === 0 ? (
        <div className="card mt-8 p-10 text-center">
          <Heart className="mx-auto size-8 text-faint" strokeWidth={1.4} aria-hidden />
          <p className="mt-4 text-[16px] text-muted">هنوز کتابی را نشان نکرده‌اید.</p>
          <p className="mt-1.5 text-[14px] text-faint">
            روی قلب کنار هر کتاب بزنید تا اینجا بماند.
          </p>
          <Link
            href="/books"
            className="btn mt-5 inline-flex h-11 items-center rounded-lg bg-violet px-5 text-[15px] font-bold text-white"
          >
            گشتن در کاتالوگ
          </Link>
        </div>
      ) : (
        <ul className="mt-7 grid gap-4 sm:grid-cols-2">
          {data.items.map((item, i) => (
            <li key={item.bookSlug} className="card flex gap-4 p-4">
              <Link href={`/book/${item.bookSlug}`} className="shrink-0">
                <CoverArt alt={item.title} index={i} className="h-[104px] w-[72px] rounded-md" />
              </Link>

              <div className="flex min-w-0 flex-1 flex-col">
                <Link
                  href={`/book/${item.bookSlug}`}
                  className="text-[16px] font-bold leading-[1.5] text-ink hover:text-violet"
                >
                  {item.title}
                </Link>
                {item.author && (
                  <p className="mt-0.5 truncate text-[13px] text-muted">{item.author}</p>
                )}
                <p className="tnum mt-1.5 text-[13px] text-faint">
                  {item.editionCount.toLocaleString("fa-IR")} روایت
                </p>

                <div className="mt-auto flex items-end justify-between gap-2 pt-3">
                  {item.owned ? (
                    <span className="chip chip-paper text-[12px] text-mint-ink">
                      در کتابخانه شماست
                    </span>
                  ) : (
                    <span className="tnum text-[14px] font-bold text-ink">
                      از {fmtToman(item.fromRial)}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => void remove(item.bookSlug)}
                    disabled={busy !== null}
                    aria-label={`حذف ${item.title} از علاقه‌مندی‌ها`}
                    className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full border border-line text-violet transition-colors hover:border-violet-200 disabled:opacity-60"
                  >
                    {busy === item.bookSlug ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Heart className="size-4 fill-current" strokeWidth={1.8} aria-hidden />
                    )}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
