"use client";

import { Loader2, Lock, Moon, Play } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AvatarBadge } from "@/components/kids/AvatarBadge";
import { ExitLock } from "@/components/kids/ExitLock";
import { CoverArt } from "@/components/primitives/CoverArt";
import { coverIndex } from "@/lib/catalog";
import { ApiError, getKidsShelf, type KidsShelf } from "@/lib/platform";

/**
 * The child's own surface.
 *
 * Rule 5 of the spec's allocation rules is explicit that this is a real app and
 * not a promotional page: «وب‌اپ کودک باید مستقل از موبایل، کاملاً کاربردی و
 * پاسخگو باشد، نه صرفاً یک نسخه تبلیغاتی» — because a lot of parents hand a
 * child the home computer rather than a phone.
 *
 * So the shape follows the spec's kids rows rather than the adult library's:
 *
 *   * «ادامه شنیدن باید بزرگ‌ترین عنصر صفحه اول باشد» — it is the hero, and the
 *     server decides which title that is so every client agrees.
 *   * «قصه شب … باید در صفحه اول باشد نه پشت سه کلیک» — the bedtime timer is on
 *     this screen, not inside the player.
 *   * Big covers, no heavy text, no nested menus, and no settings at all: every
 *     decision about this child belongs to the parent panel.
 */
export default function KidsPage() {
  const router = useRouter();
  const { childId } = useParams<{ childId: string }>();

  const [shelf, setShelf] = useState<KidsShelf | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bedtimeMin, setBedtimeMin] = useState<number | null>(null);

  /* Fetched inside an async callback rather than by calling a `load()` helper
     from the effect body. Both reach the same request, but a helper that
     setStates synchronously is a cascading render; this resolves first and
     drops its result if the screen has already moved on. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getKidsShelf(childId);
        if (!cancelled) setShelf(data);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace(`/login?next=/kids/${childId}`);
          return;
        }
        setError("این قفسه باز نشد.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [childId, router]);

  if (error) {
    return <main className="grid min-h-dvh place-items-center text-muted">{error}</main>;
  }
  if (!shelf) {
    return (
      <main className="grid min-h-dvh place-items-center">
        <Loader2 className="size-8 animate-spin text-violet" aria-label="بارگیری" />
      </main>
    );
  }

  const { screenTime: st } = shelf;

  const open = (editionId: string) => {
    const q = new URLSearchParams({ profile: childId });
    if (bedtimeMin) q.set("sleep", String(bedtimeMin));
    router.push(`/kids/${childId}/play/${editionId}?${q}`);
  };

  return (
    /* Its own full-bleed shell rather than the site chrome: the header's nav,
       search and footer links are all routes out of kids mode. */
    <main className="min-h-dvh bg-[radial-gradient(120%_80%_at_50%_0%,#EEF0FF_0%,#F7F8FC_60%)] pb-16">
      <div className="container-k pt-6">
        <header className="flex items-center gap-3">
          <AvatarBadge avatar={shelf.child.avatar} className="size-14 text-[30px]" />
          <h1 className="text-[26px] font-bold text-ink sm:text-[32px]">
            سلام {shelf.child.name}!
          </h1>
          <ExitLock className="ms-auto" />
        </header>

        {/* Time left, as a sentence a child can read. No numbers-as-warning. */}
        {st.capMinutes !== null && (
          <p
            className={`mt-4 rounded-2xl px-4 py-3 text-[17px] font-medium ${
              st.exhausted
                ? "bg-amber-100 text-amber-800"
                : "bg-white/70 text-ink-2"
            }`}
          >
            {st.exhausted
              ? "وقت قصه‌ی امروز تمام شد. فردا دوباره!"
              : `امروز ${st.remainingMinutes} دقیقه قصه مانده`}
          </p>
        )}

        {/* ── Continue listening: the largest thing on the page ── */}
        {shelf.resume && !st.exhausted && (
          <section className="mt-6">
            <button
              type="button"
              onClick={() => open(shelf.resume!.editionId)}
              className="btn group flex w-full items-center gap-5 rounded-3xl bg-violet p-5 text-right text-white shadow-e3 sm:p-6"
            >
              <span className="grid size-20 shrink-0 place-items-center rounded-full bg-white/20 sm:size-24">
                <Play className="size-10 translate-x-0.5 sm:size-12" fill="currentColor" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] opacity-90">ادامه بدهیم؟</span>
                <span className="block truncate text-[24px] font-bold sm:text-[30px]">
                  {shelf.resume.title}
                </span>
              </span>
            </button>
          </section>
        )}

        {/* ── Bedtime timer, on the first screen ── */}
        <section className="mt-6">
          <h2 className="flex items-center gap-2 text-[17px] font-bold text-ink">
            <Moon className="size-4 text-violet" strokeWidth={2} aria-hidden />
            قصه‌ی شب
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {[10, 20, 30].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setBedtimeMin((v) => (v === m ? null : m))}
                aria-pressed={bedtimeMin === m}
                className={`tnum rounded-2xl px-5 py-3 text-[17px] font-bold transition-colors ${
                  bedtimeMin === m
                    ? "bg-night text-white"
                    : "bg-white text-ink-2 shadow-e1"
                }`}
              >
                {m} دقیقه
              </button>
            ))}
          </div>
          {bedtimeMin && (
            <p className="mt-2 text-[15px] text-muted">
              بعد از {bedtimeMin} دقیقه خودش خاموش می‌شود.
            </p>
          )}
        </section>

        {/* ── The shelf ── */}
        <section className="mt-8">
          <h2 className="text-[17px] font-bold text-ink">قفسه‌ی من</h2>
          {shelf.items.length === 0 ? (
            <p className="mt-3 rounded-2xl bg-white/70 p-5 text-[16px] leading-[1.85] text-muted">
              هنوز قصه‌ای اینجا نیست. از پدر یا مادرت بخواه یکی اضافه کند.
            </p>
          ) : (
            <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {shelf.items.map((item) => (
                <li key={item.editionId}>
                  <button
                    type="button"
                    onClick={() => open(item.editionId)}
                    disabled={st.exhausted}
                    className="group flex w-full flex-col gap-2.5 text-right disabled:opacity-50"
                  >
                    <span className="overflow-hidden rounded-2xl shadow-e1 transition-transform duration-300 group-hover:-translate-y-1">
                      <CoverArt alt={item.title} index={coverIndex(item.bookSlug)} className="aspect-[3/4]" rounded="rounded-2xl" />
                    </span>
                    <span className="line-clamp-2 text-[16px] font-bold leading-[1.6] text-ink">
                      {item.title}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Rule 2, visible. The child gets these and never a text box; the
            server ships the list so a client cannot invent an input instead. */}
        <section className="mt-10">
          <h2 className="flex items-center gap-2 text-[17px] font-bold text-ink">
            <Lock className="size-4 text-mint-ink" strokeWidth={2} aria-hidden />
            می‌توانی این‌ها را بپرسی
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {shelf.presetQuestions.map((q) => (
              <li
                key={q}
                className="rounded-2xl bg-white px-4 py-2.5 text-[15px] text-ink-2 shadow-e1"
              >
                {q}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
