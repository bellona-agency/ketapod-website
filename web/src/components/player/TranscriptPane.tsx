"use client";

import { useEffect, useRef } from "react";
import type { TranscriptCue } from "@/lib/catalog";

/**
 * The time-aligned transcript, following the play head.
 *
 * The spec calls this structure the project's most valuable technical asset and
 * lists four jobs it does at once. This component is the third of them —
 * text/audio sync — and it is also the one that makes the other three visible
 * to whoever is looking at the screen.
 *
 * Two details matter more than they look:
 *
 *   * Every cue is a button. The transcript is not decoration to be watched; a
 *     reader who spots the sentence they wanted should be able to jump to it,
 *     which is also what makes the pane usable by keyboard.
 *   * Auto-scroll yields to the reader. Someone who scrolls up to re-read a
 *     paragraph must not be yanked back a second later, so following resumes
 *     only after they return to where the head is.
 */
export function TranscriptPane({
  cues,
  currentTime,
  onSeek,
}: {
  cues: TranscriptCue[];
  currentTime: number;
  onSeek: (sec: number) => void;
}) {
  const activeIndex = cues.findIndex(
    (c) => currentTime >= c.startSec && currentTime < c.endSec,
  );

  const listRef = useRef<HTMLOListElement | null>(null);
  const activeRef = useRef<HTMLLIElement | null>(null);
  /* Set when the reader scrolls away themselves. */
  const detachedRef = useRef(false);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onScroll = () => {
      const el = activeRef.current;
      if (!el) return;
      const listBox = list.getBoundingClientRect();
      const cueBox = el.getBoundingClientRect();
      /* Following resumes once the active line is back in view. */
      detachedRef.current = cueBox.bottom < listBox.top || cueBox.top > listBox.bottom;
    };
    list.addEventListener("scroll", onScroll, { passive: true });
    return () => list.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (detachedRef.current) return;
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIndex]);

  if (cues.length === 0) return null;

  const sampleEnd = cues[cues.length - 1]?.endSec ?? 0;
  const past = currentTime > sampleEnd;

  return (
    <section className="card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-bold text-ink">متن همگام</h2>
        <span className="text-[12px] text-faint">نمونه ابتدای کتاب</span>
      </div>

      <ol
        ref={listRef}
        className="mt-3 flex max-h-72 flex-col gap-1 overflow-y-auto scroll-smooth"
      >
        {cues.map((cue, i) => {
          const active = i === activeIndex;
          const done = currentTime >= cue.endSec;
          return (
            <li key={cue.startSec} ref={active ? activeRef : undefined}>
              <button
                type="button"
                onClick={() => onSeek(cue.startSec)}
                aria-current={active ? "true" : undefined}
                className={`w-full rounded-md px-3 py-2.5 text-right text-[15px] leading-[1.95] transition-colors ${
                  active
                    ? "bg-violet-50 font-medium text-ink"
                    : done
                      ? "text-faint hover:bg-paper-2"
                      : "text-ink-2 hover:bg-paper-2"
                }`}
              >
                {cue.text}
              </button>
            </li>
          );
        })}
      </ol>

      {past && (
        <p className="mt-3 rounded-md bg-paper-2 px-3 py-2.5 text-[13px] leading-[1.8] text-muted">
          نمونه متن تا اینجاست. ترنسکریپت کامل با تولید صوت هر نسخه ساخته می‌شود.
        </p>
      )}
    </section>
  );
}
