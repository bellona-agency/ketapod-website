"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef } from "react";

/**
 * Arrow controls for a horizontal rail.
 *
 * Every rail on this page sets `no-scrollbar`, which is right for the design and
 * fine on a phone — a rail is swipeable. On a desktop it leaves the rail with no
 * affordance at all: no scrollbar to drag, nothing to swipe, and a vertical
 * wheel does not move a horizontal scroller. The catalogue rail overflowed by
 * ~255px on a 1536px window with no way to reach it.
 *
 * The buttons find their rail rather than being handed a ref, because the rail
 * and the heading that holds these controls are in different branches of the
 * section — passing a ref between them would mean making the whole section a
 * client component to own it.
 */
export function RailNudge({
  prevLabel,
  nextLabel,
  className,
}: {
  prevLabel: string;
  nextLabel: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  function nudge(dir: 1 | -1) {
    const rail = ref.current
      ?.closest("section")
      ?.querySelector<HTMLElement>("[data-rail]");
    if (!rail) return;

    /* A card plus its gap, read off the rail rather than hard-coded, so the
       catalogue's 220px cards and the testimonials' 340px ones both land on a
       card edge instead of halfway through one. */
    const first = rail.firstElementChild as HTMLElement | null;
    const gap = parseFloat(getComputedStyle(rail).columnGap) || 16;
    const step = first ? first.offsetWidth + gap : 340;

    /* RTL scroll offsets run negative, so "next" — the direction the content
       continues in — is a negative delta. */
    rail.scrollBy({ left: dir * -step, behavior: "smooth" });
  }

  return (
    <div ref={ref} className={className ?? "flex items-center gap-2"}>
      <RailButton onClick={() => nudge(-1)} label={prevLabel}>
        <ChevronRight className="size-5" strokeWidth={1.8} />
      </RailButton>
      <RailButton onClick={() => nudge(1)} label={nextLabel}>
        <ChevronLeft className="size-5" strokeWidth={1.8} />
      </RailButton>
    </div>
  );
}

function RailButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid size-11 cursor-pointer place-items-center rounded-full border border-line-2 bg-card text-ink transition-colors duration-200 hover:border-ink hover:bg-ink hover:text-white"
    >
      {children}
    </button>
  );
}
