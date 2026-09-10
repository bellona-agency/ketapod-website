"use client";

import { Bookmark, Loader2, NotebookPen, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useResource } from "@/hooks/useResource";
import { deleteMark, getMarks, type MarkRow } from "@/lib/platform";
import { cn, formatTime } from "@/lib/utils";

/**
 * Everything the listener has marked, across every book.
 *
 * One list rather than a tab per book, because a note is a thought someone
 * wants to find again and they will not remember which book they were in when
 * they had it. The book title is on the row instead — as context, not as a
 * filing system.
 *
 * Every timestamp is a link back into the player at that second. A note about a
 * sentence, detached from the sentence, is half a note.
 */

type Tab = "bookmarks" | "notes";

export default function NotesPage() {
  const { data, error, reload } = useResource(getMarks, "/account/notes");
  const [tab, setTab] = useState<Tab>("bookmarks");
  const [busy, setBusy] = useState<string | null>(null);

  async function remove(id: string) {
    setBusy(id);
    try {
      await deleteMark(id);
      reload();
    } finally {
      setBusy(null);
    }
  }

  if (error) return <p className="py-20 text-center text-muted">{error}</p>;
  if (!data) {
    return <Loader2 className="mx-auto mt-16 size-6 animate-spin text-muted" aria-label="بارگیری" />;
  }

  const rows = tab === "bookmarks" ? data.bookmarks : data.notes;

  return (
    <div>
      <span className="eyebrow text-muted">نگه‌داشته‌ها</span>
      <h1 className="mt-2 text-[27px] font-bold text-ink sm:text-[34px]">
        یادداشت‌ها و نشان‌ها
      </h1>

      <div role="tablist" aria-label="نوع" className="mt-6 flex gap-2">
        <TabButton
          active={tab === "bookmarks"}
          onClick={() => setTab("bookmarks")}
          icon={<Bookmark className="size-4" />}
          label="نشان‌ها"
          count={data.bookmarks.length}
        />
        <TabButton
          active={tab === "notes"}
          onClick={() => setTab("notes")}
          icon={<NotebookPen className="size-4" />}
          label="یادداشت‌ها"
          count={data.notes.length}
        />
      </div>

      {rows.length === 0 ? (
        <div className="card mt-6 p-10 text-center">
          <p className="text-[16px] text-muted">
            {tab === "bookmarks" ? "هنوز نشانی نگذاشته‌اید." : "هنوز یادداشتی ننوشته‌اید."}
          </p>
          <p className="mt-1.5 max-w-[46ch] mx-auto text-[14px] leading-[1.85] text-faint">
            {tab === "bookmarks"
              ? "حین پخش، دکمه‌ی نشان را بزنید. اگر «نشان هوشمند» را انتخاب کنید، خلاصه‌ی همان لحظه هم ساخته می‌شود."
              : "در پخش‌کننده می‌توانید روی هر لحظه یادداشت بگذارید."}
          </p>
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id} className="rounded-lg border border-line bg-card p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/player/${row.editionId}?t=${row.positionSec}`}
                      className="tnum rounded-md bg-violet-50 px-2 py-1 text-[13px] font-bold text-violet transition-colors hover:bg-violet-100"
                    >
                      {formatTime(row.positionSec)}
                    </Link>
                    <span className="truncate text-[14px] text-muted">
                      {row.bookTitle}
                      {row.voiceName && ` · ${row.voiceName}`}
                    </span>
                  </div>

                  {tab === "notes" ? (
                    <p className="mt-3 whitespace-pre-wrap text-[15px] leading-[1.95] text-ink">
                      {row.body}
                    </p>
                  ) : (
                    <>
                      <p className="mt-2.5 text-[15px] font-medium text-ink">{row.label}</p>
                      <SmartSummary row={row} />
                    </>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => void remove(row.id)}
                  disabled={busy !== null}
                  aria-label="حذف"
                  className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg border border-line text-faint transition-colors hover:border-red-200 hover:text-red-700 disabled:opacity-60"
                >
                  {busy === row.id ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Trash2 className="size-4" strokeWidth={1.8} aria-hidden />
                  )}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The smart bookmark's summary, or the honest state it is in.
 *
 * «در حال ساخت» is shown rather than hidden, because the summary is built by a
 * worker after the response — the spec asks for exactly that so the button does
 * not wait on a model — and a row that silently lacks one looks broken. The
 * text appears on the next load of this page, which is the tradeoff the
 * background job buys.
 */
function SmartSummary({ row }: { row: MarkRow }) {
  if (row.summaryState === "none" || !row.summaryState) return null;

  if (row.summaryState === "pending") {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-[13px] text-faint">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        خلاصه در حال ساخته‌شدن است…
      </p>
    );
  }
  return (
    <p className="mt-2.5 flex gap-2 rounded-lg bg-paper-2 p-3 text-[14px] leading-[1.9] text-muted">
      <Sparkles className="mt-1 size-3.5 shrink-0 text-violet" aria-hidden />
      {row.summary}
    </p>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-[15px] transition-colors",
        active
          ? "border-violet-200 bg-violet-50 font-bold text-violet"
          : "border-line bg-card text-muted hover:text-ink",
      )}
    >
      <span aria-hidden>{icon}</span>
      {label}
      <span className="tnum text-[13px] opacity-70">
        {count.toLocaleString("fa-IR")}
      </span>
    </button>
  );
}
