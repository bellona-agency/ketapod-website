import { BOOKS } from "@/lib/catalog";
import { dayKey, db } from "@/lib/mock/db";
import { dailyMinutes } from "@/lib/mock/growth";
import { requireUser } from "@/lib/mock/session";

/**
 * برنامه مطالعاتی — a daily goal and how today is going against it.
 *
 * The goal is in *minutes* because the listening ledger already counts in
 * minutes. Expressing it in chapters or pages would mean maintaining a second
 * notion of progress that has to be kept in step with the first, and the two
 * would disagree the first time someone re-listened to a chapter.
 *
 * The finish-date estimate is honest about what it does not know: it divides
 * what is left of the book by the goal and counts only the days the plan is
 * actually scheduled for. A plan for five days a week does not finish a book in
 * seven days' worth of sessions.
 */

/** Saturday-first, matching the week the Persian calendar and the UI use. */
const DAY_NAMES = ["شنبه", "یک‌شنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنج‌شنبه", "جمعه"];

/** JS `getDay()` is Sunday-first. This shifts it to Saturday-first. */
const persianDayIndex = (d: Date) => (d.getDay() + 1) % 7;

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;
  const { user } = auth;

  const plan = db.plans.find((p) => p.userId === user.id) ?? null;
  const todayMinutes = Math.round(dailyMinutes(user.id).get(dayKey()) ?? 0);

  if (!plan) {
    return Response.json({ plan: null, today: { minutes: todayMinutes }, dayNames: DAY_NAMES });
  }

  const scheduledToday = plan.daysOfWeek.includes(persianDayIndex(new Date()));

  /* Where the plan's book stands, if one was chosen. Read from the furthest
     position across that book's editions: switching from the human narration to
     the AI one is still progress through the same work. */
  const book = plan.bookSlug ? BOOKS.find((b) => b.slug === plan.bookSlug) : null;
  let remainingMinutes: number | null = null;
  let bookPercent: number | null = null;
  if (book) {
    const best = book.editions
      .map((e) => {
        const pos = db.positions.find(
          (p) => p.userId === user.id && p.editionId === e.id,
        );
        return { duration: e.durationSec, at: pos?.positionSec ?? 0 };
      })
      .reduce((hi, cur) => (cur.at > hi.at ? cur : hi), { duration: 0, at: 0 });
    if (best.duration > 0) {
      remainingMinutes = Math.max(0, Math.round((best.duration - best.at) / 60));
      bookPercent = Math.round((best.at / best.duration) * 100);
    }
  }

  const sessionsNeeded =
    remainingMinutes !== null && plan.dailyMinutes > 0
      ? Math.ceil(remainingMinutes / plan.dailyMinutes)
      : null;

  return Response.json({
    plan,
    dayNames: DAY_NAMES,
    today: {
      minutes: todayMinutes,
      scheduled: scheduledToday,
      goalMet: scheduledToday && todayMinutes >= plan.dailyMinutes,
      /* Zero rather than negative on an over-achieving day. "منفی ۸ دقیقه
         مانده" is not a sentence anyone wants to read about their own effort. */
      remainingMinutes: Math.max(0, plan.dailyMinutes - todayMinutes),
    },
    book: book
      ? {
          slug: book.slug,
          title: book.title,
          percent: bookPercent,
          remainingMinutes,
          sessionsNeeded,
          estimatedFinish: estimateFinish(sessionsNeeded, plan.daysOfWeek),
        }
      : null,
  });
}

/** Create or replace. One plan per account — a second goal is a second thing to
 *  fail at, and the screen only ever shows one. */
export async function PUT(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;
  const { user } = auth;

  const body = (await req.json().catch(() => ({}))) as {
    dailyMinutes?: number;
    daysOfWeek?: number[];
    reminderAt?: string;
    bookSlug?: string | null;
    targetDate?: string | null;
  };

  const minutes = Math.floor(body.dailyMinutes ?? 0);
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 480) {
    return Response.json(
      { error: "invalid_goal", message: "هدف روزانه بین ۵ تا ۴۸۰ دقیقه باشد." },
      { status: 422 },
    );
  }

  const days = Array.from(
    new Set((body.daysOfWeek ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)),
  ).sort();
  if (days.length === 0) {
    return Response.json(
      { error: "no_days", message: "دست‌کم یک روز هفته را انتخاب کنید." },
      { status: 422 },
    );
  }

  const reminderAt = /^\d{2}:\d{2}$/.test(body.reminderAt ?? "")
    ? (body.reminderAt as string)
    : "21:00";

  if (body.bookSlug && !BOOKS.some((b) => b.slug === body.bookSlug)) {
    /* 422 rather than silently storing it. A plan pointing at a book that does
       not exist looks like a working plan and quietly never reports progress. */
    return Response.json({ error: "unknown_book" }, { status: 422 });
  }

  const row = {
    userId: user.id,
    dailyMinutes: minutes,
    daysOfWeek: days,
    reminderAt,
    bookSlug: body.bookSlug ?? null,
    targetDate: body.targetDate ?? null,
    createdAt: new Date().toISOString(),
  };

  const index = db.plans.findIndex((p) => p.userId === user.id);
  if (index >= 0) {
    row.createdAt = db.plans[index].createdAt;
    db.plans[index] = row;
  } else {
    db.plans.push(row);
  }

  return Response.json({ plan: row });
}

export async function DELETE(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;
  db.plans = db.plans.filter((p) => p.userId !== auth.user.id);
  return Response.json({ ok: true });
}

/**
 * Walk the calendar forward, counting only scheduled days.
 *
 * Deliberately not `sessions / daysPerWeek * 7`: that average puts the finish
 * date on a day the plan does not run about half the time, and a date on an
 * unscheduled day is a date the plan cannot actually deliver.
 */
function estimateFinish(sessions: number | null, daysOfWeek: number[]) {
  if (sessions === null || sessions <= 0 || daysOfWeek.length === 0) return null;

  const cursor = new Date();
  let left = sessions;
  /* A year of walking is the guard. With at least one scheduled day a week the
     loop always terminates well inside it; the bound is there so a future bug
     in the day list cannot hang a request. */
  for (let i = 0; i < 366 && left > 0; i++) {
    cursor.setDate(cursor.getDate() + 1);
    if (daysOfWeek.includes(persianDayIndex(cursor))) left--;
  }
  return left > 0 ? null : cursor.toISOString().slice(0, 10);
}
