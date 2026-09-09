"use client";

import { ArrowRight, Check, Loader2, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AvatarBadge } from "@/components/kids/AvatarBadge";
import { WeekChart } from "@/components/kids/WeekChart";
import {
  ApiError,
  type Child,
  type ScreenTime,
  type WeeklyReport,
  deleteChild,
  getChild,
  updateChild,
} from "@/lib/platform";
import { kidsBooks } from "@/lib/catalog";

/**
 * Every book with a kid-safe edition — the set a parent decides over.
 *
 * From `kidsBooks()`, which qualifies a book through an edition marked kid-safe
 * rather than through its category, so a children's classic that only has an
 * adult narration never appears as something to approve.
 */
const CANDIDATES = kidsBooks().map((b) => ({ slug: b.slug, title: b.title }));

export default function ChildPage() {
  const router = useRouter();
  const { childId } = useParams<{ childId: string }>();

  const [child, setChild] = useState<Child | null>(null);
  const [screenTime, setScreenTime] = useState<ScreenTime | null>(null);
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [shelf, setShelf] = useState<{ slug: string; title: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  /* Every control here writes and then re-reads, so the panel always shows what
     the policy would actually serve rather than what the form believes. */
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getChild(childId);
        if (cancelled) return;
        setChild(data.child);
        setScreenTime(data.screenTime);
        setReport(data.report);
        setShelf(data.shelf);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace(`/login?next=/parent/${childId}`);
          return;
        }
        setError("این پروفایل پیدا نشد.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [childId, router, reload]);

  const patch = async (body: Record<string, unknown>) => {
    await updateChild(childId, body).catch(() => null);
    setReload((n) => n + 1);
  };

  if (error) {
    return <main className="container-k py-20 text-center text-muted">{error}</main>;
  }
  if (!child || !screenTime || !report) {
    return (
      <main className="container-k py-20">
        <Loader2 className="mx-auto size-6 animate-spin text-muted" aria-label="بارگیری" />
      </main>
    );
  }

  const onShelf = new Set(shelf.map((s) => s.slug));

  return (
    <main className="container-k py-10 sm:py-14">
      <Link
        href="/parent"
        className="inline-flex items-center gap-1.5 text-[14px] text-muted hover:text-ink"
      >
        <ArrowRight className="size-4" strokeWidth={1.8} aria-hidden />
        همه پروفایل‌ها
      </Link>

      <header className="mt-5 flex flex-wrap items-center gap-4">
        <AvatarBadge avatar={child.avatar} className="size-16 text-[34px]" />
        <div>
          <h1 className="text-[27px] font-bold text-ink sm:text-[32px]">{child.name}</h1>
          <p className="tnum text-[15px] text-muted">{child.age} ساله</p>
        </div>
        <Link
          href={`/kids/${child.id}`}
          className="btn ms-auto inline-flex h-11 items-center rounded-lg bg-violet px-5 text-[15px] font-bold text-white"
        >
          ورود به حالت کودک
        </Link>
      </header>

      <div className="mt-9 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-6">
          {/* ── Weekly report ── */}
          <section className="card p-5 sm:p-6">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[18px] font-bold text-ink">کودکم چه گوش داد</h2>
              <span className="tnum text-[14px] text-muted">
                {report.totalMinutes} دقیقه در هفته
              </span>
            </div>

            <WeekChart days={report.days} capMinutes={child.dailyCapMinutes} />

            {report.titles.length > 0 ? (
              <ul className="mt-5 flex flex-col gap-2">
                {report.titles.map((t) => (
                  <li
                    key={t.editionId}
                    className="flex items-center justify-between gap-3 rounded-md bg-paper-2 px-3 py-2.5"
                  >
                    <span className="min-w-0 flex-1 truncate text-[15px] text-ink">
                      {t.title}
                    </span>
                    <span className="tnum shrink-0 text-[14px] text-muted">
                      {t.minutes} دقیقه
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-5 text-[15px] text-muted">این هفته چیزی گوش نداده.</p>
            )}
          </section>

          {/* ── Approvals ── */}
          <section className="card p-5 sm:p-6">
            <h2 className="text-[18px] font-bold text-ink">تأیید و رد محتوا</h2>
            <label className="mt-3 flex items-start gap-3 rounded-md bg-paper-2 p-3">
              <input
                type="checkbox"
                checked={child.approvedOnly}
                onChange={(e) => void patch({ approvedOnly: e.target.checked })}
                className="mt-1 size-4 accent-violet"
              />
              <span className="text-[15px] leading-[1.75] text-ink-2">
                فقط کتاب‌هایی که تأیید کرده‌ام
                <span className="block text-[13px] text-muted">
                  با روشن‌بودن این گزینه، قفسه فقط شامل عنوان‌های تأییدشده است.
                </span>
              </span>
            </label>

            <ul className="mt-4 flex flex-col gap-1.5">
              {CANDIDATES.map((book) => {
                const allowed = child.allowedBookSlugs.includes(book.slug);
                const blocked = child.blockedBookSlugs.includes(book.slug);
                return (
                  <li
                    key={book.slug}
                    className="flex items-center gap-3 rounded-md px-2.5 py-2 hover:bg-paper-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-[15px] text-ink">
                      {book.title}
                      {!blocked && onShelf.has(book.slug) && (
                        <span className="ms-2 text-[12px] text-mint-ink">روی قفسه</span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        void patch({
                          slug: book.slug,
                          decision: allowed ? "clear" : "allow",
                        })
                      }
                      aria-pressed={allowed}
                      aria-label={`تأیید ${book.title}`}
                      className={`grid size-8 place-items-center rounded-md transition-colors ${
                        allowed ? "bg-mint-100 text-mint-ink" : "bg-paper-2 text-faint"
                      }`}
                    >
                      <Check className="size-4" strokeWidth={2.2} aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void patch({
                          slug: book.slug,
                          decision: blocked ? "clear" : "block",
                        })
                      }
                      aria-pressed={blocked}
                      aria-label={`رد ${book.title}`}
                      className={`grid size-8 place-items-center rounded-md transition-colors ${
                        blocked ? "bg-amber-100 text-amber-700" : "bg-paper-2 text-faint"
                      }`}
                    >
                      <X className="size-4" strokeWidth={2.2} aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-[13px] leading-[1.7] text-muted">
              کتاب‌هایی که هیچ نسخه مناسب کودک ندارند اصلاً در این فهرست نیستند —
              دسته‌بندی «کودک» به‌تنهایی کافی نیست.
            </p>
          </section>
        </div>

        {/* ── Settings ── */}
        <aside className="flex flex-col gap-6">
          <section className="card p-5">
            <h2 className="text-[16px] font-bold text-ink">سقف زمان روزانه</h2>
            <p className="tnum mt-2 text-[15px] text-muted">
              امروز {screenTime.usedMinutes} دقیقه
              {screenTime.capMinutes !== null && ` از ${screenTime.capMinutes}`}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {[20, 30, 45, 60, 90].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => void patch({ dailyCapMinutes: m })}
                  aria-pressed={child.dailyCapMinutes === m}
                  className={`tnum rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
                    child.dailyCapMinutes === m
                      ? "bg-violet text-white"
                      : "bg-paper-2 text-ink-2 hover:bg-violet-50"
                  }`}
                >
                  {m} دقیقه
                </button>
              ))}
              <button
                type="button"
                onClick={() => void patch({ dailyCapMinutes: null })}
                aria-pressed={child.dailyCapMinutes === null}
                className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  child.dailyCapMinutes === null
                    ? "bg-violet text-white"
                    : "bg-paper-2 text-ink-2 hover:bg-violet-50"
                }`}
              >
                بی‌سقف
              </button>
            </div>

            {/* The split the spec asks for, said plainly, because a parent who
                assumes the server can stop playback mid-flight would be wrong. */}
            <p className="mt-4 text-[13px] leading-[1.7] text-muted">
              شمارش روی سرور نگه داشته می‌شود ولی توقف را خود دستگاه اعمال می‌کند،
              تا آفلاین هم کار کند.
            </p>
          </section>

          <section className="card p-5">
            <h2 className="text-[16px] font-bold text-ink">سن</h2>
            <input
              type="range"
              min={2}
              max={14}
              value={child.age}
              onChange={(e) => void patch({ age: Number(e.target.value) })}
              className="mt-3 h-11 w-full"
              aria-label="سن کودک"
            />
            <p className="tnum text-[15px] text-muted">{child.age} سال</p>
          </section>

          <button
            type="button"
            onClick={async () => {
              if (!confirm(`پروفایل ${child.name} و تاریخچه‌اش حذف شود؟`)) return;
              await deleteChild(childId).catch(() => null);
              router.push("/parent");
            }}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-line text-[15px] font-medium text-amber-700 transition-colors hover:border-amber-200"
          >
            <Trash2 className="size-4" strokeWidth={1.8} aria-hidden />
            حذف پروفایل
          </button>
        </aside>
      </div>
    </main>
  );
}
