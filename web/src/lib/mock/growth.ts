/**
 * Streaks, levels and badges.
 *
 * The spec puts a hard rule on this module in particular: «قواعد سطح‌بندی در
 * بک‌اند نگهداری شود نه در فرانت، وگرنه وب و موبایل واگرا می‌شوند» — and more
 * broadly, «هیچ منطق کسب‌وکاری در فرانت نوشته نشود … اگر این قاعده شکسته شود،
 * هر قاعده سه بار نوشته می‌شود — وب، موبایل، کودک — و سپس سه نسخه از هم واگرا
 * می‌شوند».
 *
 * So every threshold lives here and the client is handed conclusions, never
 * inputs to a formula. The dashboard renders `level.title`; it does not know
 * what earns a level, and cannot drift from the app that also does not know.
 */

import { dayKey, db } from "./db";

/* ── Streak ──────────────────────────────────────────────────────────────— */

/** A day counts once at least this much was listened. */
const STREAK_MINUTE_THRESHOLD = 5;

/**
 * Consecutive qualifying days ending today — or yesterday.
 *
 * Yesterday is deliberate. A streak that resets the instant midnight passes
 * punishes someone who has not listened *yet today*, which at 9am is everyone.
 * It breaks only once a full qualifying day has been missed.
 */
export function streakOf(userId: string) {
  const byDay = dailyMinutes(userId);

  const qualifies = (d: Date) =>
    (byDay.get(dayKey(d)) ?? 0) >= STREAK_MINUTE_THRESHOLD;

  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);

  let cursor: Date;
  if (qualifies(today)) cursor = today;
  else if (qualifies(yesterday)) cursor = yesterday;
  else return { current: 0, longest: longestRun(byDay), activeToday: false };

  let current = 0;
  while (qualifies(cursor)) {
    current += 1;
    cursor = new Date(cursor.getTime() - 86_400_000);
  }

  return { current, longest: Math.max(current, longestRun(byDay)), activeToday: qualifies(today) };
}

function longestRun(byDay: Map<string, number>) {
  const days = [...byDay.entries()]
    .filter(([, m]) => m >= STREAK_MINUTE_THRESHOLD)
    .map(([d]) => d)
    .sort();

  let best = 0;
  let run = 0;
  let prev: number | null = null;

  for (const day of days) {
    const t = Date.parse(`${day}T00:00:00`);
    run = prev !== null && t - prev === 86_400_000 ? run + 1 : 1;
    prev = t;
    best = Math.max(best, run);
  }
  return best;
}

/**
 * Minutes per day for an account, its own listening and its children's.
 *
 * Both come from the same table, which is the point of having generalised it:
 * an earlier version derived the adult's minutes from position values and
 * produced a 168-minute spike on a single day out of what were really three
 * bookmarks. A position says where you are, not how long you were there.
 *
 * A parent listening on their own and a child listening on theirs are one
 * household habit, and the spec's streak is an account-level idea, so they are
 * summed rather than kept apart.
 */
export function dailyMinutes(userId: string) {
  const byDay = new Map<string, number>();
  for (const s of db.listening) {
    if (s.userId !== userId) continue;
    byDay.set(s.day, (byDay.get(s.day) ?? 0) + s.seconds / 60);
  }
  return byDay;
}

/* ── Levels ──────────────────────────────────────────────────────────────— */

/**
 * «کتابخوان اعظم» and the rungs below it.
 *
 * Thresholds in listened minutes. Kept as one ordered table so a change is one
 * edit rather than a search through comparisons.
 */
const LEVELS = [
  { min: 0, title: "تازه‌وارد" },
  { min: 60, title: "شنونده" },
  { min: 300, title: "کتاب‌خوان" },
  { min: 900, title: "کتاب‌خوان جدی" },
  { min: 2400, title: "کتابخوان اعظم" },
] as const;

export function levelOf(totalMinutes: number) {
  let index = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    if (totalMinutes >= LEVELS[i].min) index = i;
  }
  const next = LEVELS[index + 1] ?? null;
  return {
    index,
    title: LEVELS[index].title,
    nextTitle: next?.title ?? null,
    /* Sent as a fraction rather than as the two numbers behind it, so the
       client cannot recompute — and cannot recompute differently. */
    progressToNext: next
      ? Math.min(1, (totalMinutes - LEVELS[index].min) / (next.min - LEVELS[index].min))
      : 1,
    minutesToNext: next ? Math.max(0, next.min - totalMinutes) : 0,
  };
}

/* ── Badges ──────────────────────────────────────────────────────────────— */

export interface Badge {
  id: string;
  title: string;
  hint: string;
  earned: boolean;
}

export function badgesOf(userId: string): Badge[] {
  const streak = streakOf(userId);
  const totals = totalMinutesOf(userId);
  const finished = db.positions.filter((p) => {
    if (p.userId !== userId) return false;
    const ed = db.entitlements.find((e) => e.editionId === p.editionId);
    return Boolean(ed);
  }).length;

  const bookmarks = db.bookmarks.filter((b) => b.userId === userId).length;
  const notes = db.notes.filter((n) => n.userId === userId).length;

  return [
    {
      id: "first_hour",
      title: "اولین ساعت",
      hint: "یک ساعت شنیدن",
      earned: totals >= 60,
    },
    {
      id: "week_streak",
      title: "هفت روز پیاپی",
      hint: "هفت روز پشت سر هم",
      earned: streak.longest >= 7,
    },
    {
      id: "collector",
      title: "قفسه‌چین",
      hint: "سه نسخه در کتابخانه",
      earned: finished >= 3,
    },
    {
      id: "marker",
      title: "نشانه‌گذار",
      hint: "پنج نشانه",
      earned: bookmarks >= 5,
    },
    {
      id: "note_taker",
      title: "یادداشت‌بردار",
      hint: "سه یادداشت",
      earned: notes >= 3,
    },
  ];
}

export function totalMinutesOf(userId: string) {
  return Math.round([...dailyMinutes(userId).values()].reduce((a, b) => a + b, 0));
}

/** The last N days, oldest first — the learning dashboard's chart. */
export function historyOf(userId: string, days = 14) {
  const byDay = dailyMinutes(userId);
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.now() - (days - 1 - i) * 86_400_000);
    const key = dayKey(d);
    return { day: key, minutes: Math.round(byDay.get(key) ?? 0) };
  });
}

/**
 * Smart Recap — how long since the last qualifying day.
 *
 * The spec pairs this with a push: «دو هفته است برنگشتی، این خلاصه فصل‌های قبل
 * است». The server decides that it is due, not the client, so web and app
 * cannot disagree about whether someone has been away.
 */
export function recapDue(userId: string) {
  const byDay = dailyMinutes(userId);
  const active = [...byDay.entries()]
    .filter(([, m]) => m >= STREAK_MINUTE_THRESHOLD)
    .map(([d]) => Date.parse(`${d}T00:00:00`))
    .sort((a, b) => b - a);

  if (active.length === 0) return { due: false, daysAway: 0 };
  const daysAway = Math.floor((Date.now() - active[0]) / 86_400_000);
  return { due: daysAway >= 7, daysAway };
}
