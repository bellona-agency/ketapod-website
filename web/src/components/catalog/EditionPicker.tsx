"use client";

import { Check, Clock, ListMusic, Mic, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Cta } from "@/components/primitives/Cta";
import { formatDuration, formatPrice, type Chapter } from "@/lib/catalog";
import { LEAD_HREF, routes } from "@/lib/routes";
import { cn, formatTime } from "@/lib/utils";

/**
 * One edition, flattened for the client.
 *
 * The server resolves `voiceId` through `getVoice` before handing anything
 * down, so the `voices[].id == sources[].voiceId` contract is enforced in one
 * place and this component never does a lookup — it only ever renders a
 * narrator that has already been matched to a real source.
 */
export type EditionView = {
  id: string;
  voiceName: string;
  voiceSlug: string;
  voiceTimbre: string;
  narratorType: "human" | "ai";
  dialectTitle?: string;
  priceRial: number;
  durationSec: number;
  isKidsFriendly: boolean;
  chapters: Chapter[];
};

/**
 * Choose a performance of this book.
 *
 * The one genuinely interactive thing on a public book page, and the reason the
 * data model separates the work from its editions: a human reading, an AI
 * reading and a dialect reading are the same book at different lengths and
 * different prices, and the reader picks between them before anything else.
 *
 * Server-rendered at the default edition, so the chapter list of the reading
 * most people will buy is in the HTML for crawlers even though the switch
 * itself needs JavaScript.
 */
export function EditionPicker({
  editions,
  bookTitle,
}: {
  editions: EditionView[];
  bookTitle: string;
}) {
  const [selectedId, setSelectedId] = useState(editions[0]?.id);
  const selected = editions.find((e) => e.id === selectedId) ?? editions[0];

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="editions-heading" className="flex flex-col gap-4">
        <h2 id="editions-heading" className="text-[20px] font-bold text-ink">
          نسخه صوتی را انتخاب کنید
        </h2>

        {/*
          A plain group of toggle buttons rather than a `radiogroup`. A real
          radiogroup owns its radios directly — an `li` between them breaks that
          ownership — and it owes the user arrow-key navigation with a roving
          tabindex. Buttons carrying `aria-pressed` state the same thing, are
          announced correctly, and already behave the way Tab is expected to.
        */}
        <div role="group" aria-label="نسخه‌های صوتی" className="flex flex-col gap-3">
          {editions.map((edition) => {
            const active = edition.id === selected?.id;
            return (
              <button
                key={edition.id}
                type="button"
                aria-pressed={active}
                onClick={() => setSelectedId(edition.id)}
                className={cn(
                  "flex w-full cursor-pointer items-start gap-4 rounded-lg border p-4 text-right transition-[border-color,background-color,box-shadow] duration-200",
                  active
                    ? "border-violet bg-violet-50 shadow-e2"
                    : "border-line-2 bg-card hover:border-line-2 hover:bg-paper-2",
                )}
              >
                <span
                  className={cn(
                    "chip chip-sm mt-0.5",
                    active ? "bg-violet text-white" : "chip-paper",
                  )}
                  aria-hidden
                >
                  {edition.narratorType === "human" ? (
                    <Mic className="size-[18px]" strokeWidth={1.7} />
                  ) : (
                    <Sparkles className="size-[18px]" strokeWidth={1.7} />
                  )}
                </span>

                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[17px] font-bold text-ink">{edition.voiceName}</span>
                    {edition.dialectTitle && (
                      <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-[12px] font-medium text-violet-700">
                        {edition.dialectTitle}
                      </span>
                    )}
                    {edition.isKidsFriendly && (
                      <span className="rounded-full bg-mint-100 px-2.5 py-0.5 text-[12px] font-medium text-mint-ink">
                        مناسب کودک
                      </span>
                    )}
                  </span>

                  <span className="text-[15px] text-muted">{edition.voiceTimbre}</span>

                  <span className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-faint">
                    <span className="flex items-center gap-1.5">
                      <Clock className="size-3.5" strokeWidth={1.8} aria-hidden />
                      {formatDuration(edition.durationSec)}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <ListMusic className="size-3.5" strokeWidth={1.8} aria-hidden />
                      {edition.chapters.length} فصل
                    </span>
                  </span>
                </span>

                <span className="flex shrink-0 flex-col items-end gap-2">
                  <span className="text-[16px] font-bold text-ink">
                    {formatPrice(edition.priceRial)}
                  </span>
                  {active && (
                    <span className="grid size-5 place-items-center rounded-full bg-violet text-white">
                      <Check className="size-3" strokeWidth={3} aria-hidden />
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {selected && (
          <div className="flex flex-col gap-3 rounded-lg border border-line bg-card p-5">
            <p className="text-[16px] text-ink-2">
              نسخه انتخابی: <span className="font-bold text-ink">{selected.voiceName}</span> ·{" "}
              {formatDuration(selected.durationSec)} ·{" "}
              <span className="font-bold text-ink">{formatPrice(selected.priceRial)}</span>
            </p>
            <Cta
              label="رایگان گوش کن"
              href={LEAD_HREF}
              event="book_edition_cta_clicked"
              section="book"
              element="edition_cta"
              variant="violet"
              className="w-full"
              metadata={{ book: bookTitle, edition: selected.id }}
            />
            <p className="text-center text-[14px] text-faint">
              پیش‌نمایش رایگان بدون نیاز به ثبت‌نام · صدای{" "}
              <Link
                href={routes.voice(selected.voiceSlug)}
                className="font-medium text-violet hover:underline"
              >
                {selected.voiceName}
              </Link>
            </p>
          </div>
        )}
      </section>

      {selected && (
        <section aria-labelledby="chapters-heading" className="flex flex-col gap-4">
          <h2 id="chapters-heading" className="text-[20px] font-bold text-ink">
            فصل‌ها
          </h2>
          <ol className="overflow-hidden rounded-lg border border-line bg-card">
            {selected.chapters.map((chapter) => (
              <li
                key={chapter.index}
                className="flex items-center gap-4 border-b border-line px-5 py-3.5 last:border-b-0"
              >
                <span className="tnum w-6 shrink-0 text-[14px] text-faint">
                  {String(chapter.index).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1 text-[16px] text-ink-2">{chapter.title}</span>
                {/* Chapter length, not its start offset: "how long is this" is
                    the question a reader actually has here. */}
                <span className="tnum shrink-0 text-[14px] text-faint" dir="ltr">
                  {formatTime(chapter.endSec - chapter.startSec)}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
