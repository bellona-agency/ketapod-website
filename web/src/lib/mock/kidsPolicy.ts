/**
 * Kids policy, enforced server-side.
 *
 * The spec states the four rules and then says exactly where they must live:
 * «این چهار قاعده باید در بک‌اند به‌صورت policy پیاده شوند نه به‌صورت شرط در
 * فرانت». That instruction is the whole point of this file. A condition in a
 * React component is a suggestion — it is bypassed by anyone who calls the API
 * directly, and it has to be re-implemented identically in Flutter and again in
 * the standalone kids app, at which point the three copies drift.
 *
 *   1. No advertising, in any form.
 *   2. No free-text input to the assistant — preset questions only.
 *   3. No stranger-authored content; the kids catalogue is approved-only.
 *   4. No notification to the child's device — all of them to the parent's.
 *
 * The profile arrives as the `X-Profile-Id` header the spec specifies, and the
 * resolver below refuses any profile that is not a child of the calling user.
 * That check is what stops a guessed id from turning one parent's session into
 * another family's shelf.
 */

import { BOOKS, type Book } from "@/lib/catalog";
import { dayKey, db, type ChildProfile } from "./db";

export const PROFILE_HEADER = "x-profile-id";

/** Preset questions. Rule 2: the child never gets a free-text box. */
export const KIDS_PRESET_QUESTIONS = [
  "این قصه درباره چیه؟",
  "شخصیت اصلی کیه؟",
  "بعدش چی می‌شه؟",
  "یه کلمه سخت بود، یعنی چی؟",
];

export type KidsGate =
  | { ok: true; child: ChildProfile }
  | { ok: false; response: Response };

/**
 * Resolve `X-Profile-Id` to a child of *this* user.
 *
 * Ownership is re-checked on every request rather than trusted from login,
 * because the header is client-supplied and a session outlives any one screen.
 */
export function childFromRequest(req: Request, parentUserId: string): KidsGate {
  const id = req.headers.get(PROFILE_HEADER);
  if (!id) {
    return {
      ok: false,
      response: Response.json({ error: "missing_profile" }, { status: 400 }),
    };
  }
  const child = db.children.find(
    (c) => c.id === id && c.parentUserId === parentUserId,
  );
  if (!child) {
    /* 404 rather than 403: a profile belonging to someone else should not be
       distinguishable from one that does not exist. */
    return {
      ok: false,
      response: Response.json({ error: "unknown_profile" }, { status: 404 }),
    };
  }
  return { ok: true, child };
}

/**
 * The books a child may see.
 *
 * Rule 3, and the catalogue rule the public site already follows: a book
 * qualifies through an *edition* that is itself marked kid-safe, never through
 * its category. A children's classic that only has an adult narration does not
 * belong on the shelf, and category-based filtering would put it there.
 *
 * Order matters. Blocked wins over allowed, so a parent who blocks a title they
 * had previously approved gets the block.
 */
export function kidsCatalogue(child: ChildProfile): Book[] {
  return BOOKS.filter((book) => {
    if (child.blockedBookSlugs.includes(book.slug)) return false;
    if (!book.editions.some((e) => e.isKidsFriendly)) return false;
    if (child.approvedOnly && !child.allowedBookSlugs.includes(book.slug)) {
      return false;
    }
    return true;
  });
}

/** The kid-safe edition of a book, or nothing. Never falls back to an adult one. */
export const kidsEditionOf = (book: Book) =>
  book.editions.find((e) => e.isKidsFriendly);

export function mayPlayEdition(child: ChildProfile, editionId: string) {
  return kidsCatalogue(child).some((b) =>
    b.editions.some((e) => e.isKidsFriendly && e.id === editionId),
  );
}

/* ── Screen time ─────────────────────────────────────────────────────────— */

export interface ScreenTime {
  usedMinutes: number;
  capMinutes: number | null;
  remainingMinutes: number | null;
  exhausted: boolean;
}

/**
 * Today's usage against the cap.
 *
 * The spec is precise about the split: enforcement belongs on the device so it
 * survives being offline, but the setting and the running total are the
 * server's. So this is the authority on *how much is left*, and the client is
 * what stops the audio — a client that has been offline all afternoon still
 * knows its own cap, and reconciles when it reconnects.
 */
export function screenTime(child: ChildProfile, day = dayKey()): ScreenTime {
  const seconds = db.listening
    .filter((s) => s.childProfileId === child.id && s.day === day)
    .reduce((sum, s) => sum + s.seconds, 0);

  const usedMinutes = Math.round(seconds / 60);
  const capMinutes = child.dailyCapMinutes;
  if (capMinutes === null) {
    return { usedMinutes, capMinutes: null, remainingMinutes: null, exhausted: false };
  }
  const remainingMinutes = Math.max(0, capMinutes - usedMinutes);
  return {
    usedMinutes,
    capMinutes,
    remainingMinutes,
    exhausted: remainingMinutes <= 0,
  };
}

/** The last seven days, oldest first — the shape the parent's chart wants. */
export function weeklyReport(child: ChildProfile) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86_400_000);
    return dayKey(d);
  });

  const byDay = days.map((day) => ({
    day,
    minutes: Math.round(
      db.listening
        .filter((s) => s.childProfileId === child.id && s.day === day)
        .reduce((sum, s) => sum + s.seconds, 0) / 60,
    ),
  }));

  /* Titles, most-listened first. The spec calls the weekly report the most
     important parent-retention tool, and "what did they actually listen to" is
     the part a parent reads — the chart is context for it. */
  const totals = new Map<string, number>();
  for (const s of db.listening.filter(
    (x) => x.childProfileId === child.id && days.includes(x.day),
  )) {
    totals.set(s.editionId, (totals.get(s.editionId) ?? 0) + s.seconds);
  }

  const titles = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([editionId, seconds]) => {
      const book = BOOKS.find((b) => b.editions.some((e) => e.id === editionId));
      return {
        editionId,
        title: book?.title ?? "—",
        bookSlug: book?.slug ?? "",
        minutes: Math.round(seconds / 60),
      };
    });

  return {
    days: byDay,
    totalMinutes: byDay.reduce((sum, d) => sum + d.minutes, 0),
    titles,
  };
}
