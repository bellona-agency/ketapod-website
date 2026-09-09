"use client";

import { Award, Flame, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { WeekChart } from "@/components/kids/WeekChart";
import { ApiError, getProgress, type Progress } from "@/lib/platform";

/**
 * داشبورد یادگیری.
 *
 * The spec gives the web the full chart and leaves the app a weekly summary —
 * «نمودار کامل → وب؛ موبایل فقط خلاصه هفتگی» — on the same reasoning that puts
 * long-form reading on the big screen throughout the matrix.
 *
 * Not a single threshold appears in this file. Levels, streak length and badge
 * criteria all arrive decided; the page renders titles and a fraction.
 */
export default function ProgressPage() {
  const router = useRouter();
  const [data, setData] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await getProgress();
        if (!cancelled) setData(p);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login?next=/progress");
          return;
        }
        setError("داشبورد بارگیری نشد.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (error) {
    return <main className="container-k py-20 text-center text-muted">{error}</main>;
  }
  if (!data) {
    return (
      <main className="container-k py-20">
        <Loader2 className="mx-auto size-6 animate-spin text-muted" aria-label="بارگیری" />
      </main>
    );
  }

  const { streak, level, badges } = data;

  return (
    <main className="container-k py-10 sm:py-14">
      <span className="eyebrow text-muted">داشبورد یادگیری</span>
      <h1 className="mt-2 text-[27px] font-bold text-ink sm:text-[34px]">پیشرفت شما</h1>

      {data.recap.due && (
        <div className="mt-6 rounded-lg border border-violet-200 bg-violet-50 p-5">
          <p className="text-[16px] leading-[1.85] text-violet-700">
            <span className="tnum font-bold">{data.recap.daysAway} روز</span> است
            برنگشته‌اید. از کتابخانه ادامه بدهید — کتاب‌یار می‌تواند خلاصه‌ی تا اینجا
            را بگوید.
          </p>
          <Link
            href="/library"
            className="btn mt-3 inline-flex h-10 items-center rounded-lg bg-violet px-4 text-[14px] font-bold text-white"
          >
            کتابخانه
          </Link>
        </div>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <Stat
          icon={<Flame className="size-5 text-amber-500" strokeWidth={1.9} aria-hidden />}
          value={`${streak.current} روز`}
          label="زنجیره فعلی"
          note={`طولانی‌ترین: ${streak.longest} روز`}
        />
        <Stat
          icon={<Award className="size-5 text-violet" strokeWidth={1.9} aria-hidden />}
          value={level.title}
          label="سطح"
          note={
            level.nextTitle
              ? `${level.minutesToNext} دقیقه تا ${level.nextTitle}`
              : "بالاترین سطح"
          }
        />
        <Stat
          value={`${data.totalMinutes} دقیقه`}
          label="مجموع شنیدن"
          note={`${Math.round(data.totalMinutes / 60)} ساعت`}
        />
      </div>

      {level.nextTitle && (
        <div className="mt-4">
          <div className="h-2 overflow-hidden rounded-full bg-paper-2">
            <div
              className="h-full rounded-full bg-violet"
              style={{ width: `${level.progressToNext * 100}%` }}
            />
          </div>
        </div>
      )}

      <section className="card mt-8 p-5 sm:p-6">
        <h2 className="text-[18px] font-bold text-ink">دو هفته گذشته</h2>
        {/* Same chart as the parent report. One component, because "minutes per
            day against an optional target" is one thing, not two. */}
        <WeekChart days={data.history} capMinutes={null} />
      </section>

      <section className="mt-8">
        <h2 className="text-[18px] font-bold text-ink">نشان‌ها</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {badges.map((b) => (
            <li
              key={b.id}
              className={`rounded-lg border p-4 ${
                b.earned
                  ? "border-mint-100 bg-mint-50/60"
                  : "border-line bg-card opacity-70"
              }`}
            >
              <p className="text-[16px] font-bold text-ink">{b.title}</p>
              <p className="mt-1 text-[14px] text-muted">{b.hint}</p>
              {!b.earned && (
                <p className="mt-1.5 text-[12px] text-faint">هنوز باز نشده</p>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function Stat({
  icon,
  value,
  label,
  note,
}: {
  icon?: React.ReactNode;
  value: string;
  label: string;
  note: string;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-[13px] text-muted">{label}</span>
      </div>
      <p className="tnum mt-2 text-[24px] font-bold text-ink">{value}</p>
      <p className="tnum mt-0.5 text-[13px] text-faint">{note}</p>
    </div>
  );
}
