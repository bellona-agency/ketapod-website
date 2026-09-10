"use client";

import { CalendarCheck, Loader2, Target } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useResource } from "@/hooks/useResource";
import { BOOKS, formatDate } from "@/lib/catalog";
import { ApiError, deletePlan, getPlan, savePlan } from "@/lib/platform";
import { cn } from "@/lib/utils";

/**
 * برنامه مطالعاتی.
 *
 * The goal is minutes a day on chosen days, and every number the screen reports
 * against it — today's total, the sessions left, the projected finish date —
 * arrives computed. The finish date in particular is worth not recomputing
 * here: it is a walk forward through the calendar counting only scheduled days,
 * and the obvious client-side shortcut (`sessions ÷ days-per-week × 7`) lands on
 * a day the plan does not run about half the time.
 */

const GOALS = [10, 15, 20, 30, 45, 60];

export default function PlanPage() {
  const { data, error, reload } = useResource(getPlan, "/account/plan");

  const [editing, setEditing] = useState(false);
  const [minutes, setMinutes] = useState(20);
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [time, setTime] = useState("21:00");
  const [bookSlug, setBookSlug] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  function beginEdit() {
    if (data?.plan) {
      setMinutes(data.plan.dailyMinutes);
      setDays(data.plan.daysOfWeek);
      setTime(data.plan.reminderAt);
      setBookSlug(data.plan.bookSlug ?? "");
    }
    setEditing(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (days.length === 0 || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await savePlan({
        dailyMinutes: minutes,
        daysOfWeek: days,
        reminderAt: time,
        bookSlug: bookSlug || null,
      });
      setEditing(false);
      reload();
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : "ذخیره نشد.");
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!window.confirm("برنامه حذف شود؟")) return;
    await deletePlan();
    setEditing(false);
    reload();
  }

  if (error) return <p className="py-20 text-center text-muted">{error}</p>;
  if (!data) {
    return <Loader2 className="mx-auto mt-16 size-6 animate-spin text-muted" aria-label="بارگیری" />;
  }

  const { plan, today, dayNames } = data;

  return (
    <div>
      <span className="eyebrow text-muted">هدف</span>
      <h1 className="mt-2 text-[27px] font-bold text-ink sm:text-[34px]">برنامه مطالعاتی</h1>

      {plan && !editing && (
        <>
          <section
            className={cn(
              "card mt-7 p-6",
              today.goalMet ? "border-mint-100 bg-mint-50/60" : "",
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[14px] text-muted">
                  {today.scheduled ? "امروز جزو برنامه است" : "امروز روز استراحت است"}
                </p>
                <p className="tnum mt-1.5 text-[28px] font-bold text-ink">
                  {today.minutes.toLocaleString("fa-IR")} از{" "}
                  {plan.dailyMinutes.toLocaleString("fa-IR")} دقیقه
                </p>
                {today.scheduled && (
                  <p className="mt-1 text-[14px] text-muted">
                    {today.goalMet ? (
                      <span className="text-mint-ink">هدف امروز انجام شد.</span>
                    ) : (
                      <>
                        {(today.remainingMinutes ?? 0).toLocaleString("fa-IR")} دقیقه
                        مانده
                      </>
                    )}
                  </p>
                )}
              </div>
              <span className="grid size-12 place-items-center rounded-full bg-card text-violet" aria-hidden>
                {today.goalMet ? (
                  <CalendarCheck className="size-6" strokeWidth={1.7} />
                ) : (
                  <Target className="size-6" strokeWidth={1.7} />
                )}
              </span>
            </div>

            {/* A bar, capped at full. Over-achieving does not overflow the
                track — it fills it, which is what "goal met" looks like. */}
            <div className="mt-5 h-2 overflow-hidden rounded-full bg-card">
              <div
                className="h-full rounded-full bg-violet transition-[width] duration-500"
                style={{
                  width: `${Math.min(100, (today.minutes / plan.dailyMinutes) * 100)}%`,
                }}
              />
            </div>

            <div className="mt-5 flex flex-wrap gap-1.5">
              {dayNames.map((name, i) => (
                <span
                  key={name}
                  className={cn(
                    "rounded-full px-3 py-1 text-[13px]",
                    plan.daysOfWeek.includes(i)
                      ? "bg-violet-50 font-medium text-violet"
                      : "bg-card text-faint",
                  )}
                >
                  {name}
                </span>
              ))}
            </div>
            <p className="tnum mt-3 text-[13px] text-faint">
              یادآوری ساعت {plan.reminderAt} — به‌صورت اعلان در همین سایت
            </p>
          </section>

          {data.book && (
            <section className="card mt-4 p-6">
              <p className="text-[14px] text-muted">کتاب این برنامه</p>
              <Link
                href={`/book/${data.book.slug}`}
                className="mt-1 block text-[19px] font-bold text-ink hover:text-violet"
              >
                {data.book.title}
              </Link>

              {data.book.percent !== null ? (
                <>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-paper-2">
                    <div
                      className="h-full rounded-full bg-mint-ink"
                      style={{ width: `${data.book.percent}%` }}
                    />
                  </div>
                  <p className="tnum mt-3 text-[14px] leading-[1.85] text-muted">
                    {data.book.percent.toLocaleString("fa-IR")}٪ خوانده شده ·{" "}
                    {(data.book.remainingMinutes ?? 0).toLocaleString("fa-IR")} دقیقه
                    مانده
                    {data.book.sessionsNeeded !== null && (
                      <>
                        {" "}
                        · {data.book.sessionsNeeded.toLocaleString("fa-IR")} جلسه‌ی دیگر
                      </>
                    )}
                  </p>
                  {data.book.estimatedFinish && (
                    <p className="mt-1 text-[14px] font-medium text-ink">
                      با این آهنگ، حدود {formatDate(data.book.estimatedFinish)} تمام
                      می‌شود.
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-3 text-[14px] text-muted">
                  هنوز شروع نکرده‌اید. اولین جلسه، تخمین پایان را می‌سازد.
                </p>
              )}
            </section>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={beginEdit}
              className="btn h-11 cursor-pointer rounded-lg border border-line bg-card px-5 text-[15px] font-bold text-ink transition-colors hover:border-violet-200"
            >
              ویرایش برنامه
            </button>
            <button
              type="button"
              onClick={() => void stop()}
              className="btn h-11 cursor-pointer rounded-lg px-5 text-[15px] font-medium text-muted transition-colors hover:text-red-700"
            >
              حذف برنامه
            </button>
          </div>
        </>
      )}

      {(!plan || editing) && (
        <form onSubmit={submit} className="card mt-7 p-6">
          {!plan && (
            <p className="mb-5 max-w-[58ch] text-[15px] leading-[1.9] text-muted">
              یک هدف روزانه بگذارید. پیشرفت از همان دقایقی خوانده می‌شود که
              واقعاً گوش داده‌اید — چیز جداگانه‌ای برای علامت زدن نیست.
            </p>
          )}

          <fieldset>
            <legend className="text-[15px] font-medium text-ink">هدف روزانه</legend>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {GOALS.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setMinutes(g)}
                  aria-pressed={minutes === g}
                  className={cn(
                    "tnum cursor-pointer rounded-full border px-4 py-2 text-[14px] transition-colors",
                    minutes === g
                      ? "border-violet-200 bg-violet-50 font-bold text-violet"
                      : "border-line bg-card text-muted hover:text-ink",
                  )}
                >
                  {g.toLocaleString("fa-IR")} دقیقه
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="mt-6 border-t border-line pt-5">
            <legend className="text-[15px] font-medium text-ink">روزهای هفته</legend>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {dayNames.map((name, i) => {
                const on = days.includes(i);
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() =>
                      setDays((d) => (on ? d.filter((x) => x !== i) : [...d, i].sort()))
                    }
                    aria-pressed={on}
                    className={cn(
                      "cursor-pointer rounded-full border px-4 py-2 text-[14px] transition-colors",
                      on
                        ? "border-violet-200 bg-violet-50 font-bold text-violet"
                        : "border-line bg-card text-muted hover:text-ink",
                    )}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
            {days.length === 0 && (
              <p className="mt-2 text-[13px] text-red-700">دست‌کم یک روز انتخاب کنید.</p>
            )}
          </fieldset>

          <div className="mt-6 grid gap-5 border-t border-line pt-5 sm:grid-cols-2">
            <div>
              <label htmlFor="time" className="text-[15px] font-medium text-ink">
                ساعت یادآوری
              </label>
              <input
                id="time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="tnum mt-2 h-11 w-full rounded-lg border border-line bg-card px-3 text-[15px] text-ink outline-none focus:border-violet-200"
              />
            </div>
            <div>
              <label htmlFor="book" className="text-[15px] font-medium text-ink">
                کتاب هدف <span className="text-faint">(اختیاری)</span>
              </label>
              <select
                id="book"
                value={bookSlug}
                onChange={(e) => setBookSlug(e.target.value)}
                className="mt-2 h-11 w-full rounded-lg border border-line bg-card px-3 text-[15px] text-ink outline-none focus:border-violet-200"
              >
                <option value="">بدون کتاب مشخص</option>
                {BOOKS.map((b) => (
                  <option key={b.slug} value={b.slug}>
                    {b.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {failure && (
            <p role="alert" className="mt-4 text-[14px] text-red-700">
              {failure}
            </p>
          )}

          <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-5">
            <button
              type="submit"
              disabled={busy || days.length === 0}
              className="btn h-12 cursor-pointer rounded-lg bg-violet px-6 text-[16px] font-bold text-white disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : plan ? (
                "ذخیره تغییرات"
              ) : (
                "ساخت برنامه"
              )}
            </button>
            {plan && (
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="btn h-12 cursor-pointer rounded-lg px-5 text-[15px] font-medium text-muted"
              >
                انصراف
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
