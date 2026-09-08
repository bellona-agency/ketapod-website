"use client";

import { useEffect, useRef, useState } from "react";
import { cn, seeded } from "@/lib/utils";

/**
 * The brand's recurring motif.
 *
 * Bars are seeded rather than random so server and client agree, and the
 * resting height is a rounded CSS percentage — motion serialises transforms at
 * a different precision on the server than in the browser, which hydrates as a
 * mismatch.
 *
 * The pulse is a CSS keyframe, not a per-bar JS animation. Across the page
 * there are a couple of hundred bars; driving each one from the main thread
 * every frame is what made scrolling stutter on a phone. As CSS it runs on the
 * compositor, and per-bar rhythm still comes through because duration, delay
 * and peak are static custom properties set once at render.
 *
 * On top of that the animation only runs while the waveform is on screen — an
 * IntersectionObserver toggles one class on the container, so a decorative
 * waveform four sections away costs nothing at all.
 */
export function Waveform({
  bars = 32,
  active = false,
  className,
  barClassName,
  seed = 7,
  minScale = 0.18,
}: {
  bars?: number;
  active?: boolean;
  className?: string;
  barClassName?: string;
  seed?: number;
  minScale?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setOnScreen(entry.isIntersecting),
      { rootMargin: "120px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const heights = Array.from({ length: bars }, (_, i) => {
    const a = seeded(i + seed);
    const b = seeded((i + seed) * 2.7);
    // Envelope keeps the ends short so the shape reads as a clip, not a fence.
    const envelope = Math.sin((i / Math.max(bars - 1, 1)) * Math.PI) * 0.65 + 0.35;
    return Math.max(minScale, (a * 0.6 + b * 0.4) * envelope);
  });

  return (
    <div
      ref={ref}
      className={cn(
        "flex min-w-0 items-center gap-[3px]",
        active && onScreen && "kp-wave-on",
        className,
      )}
      aria-hidden
      role="presentation"
    >
      {heights.map((h, i) => (
        <span
          key={i}
          className={cn(
            "kp-wave-bar block w-[3px] min-w-0 flex-1 origin-center rounded-full bg-current",
            barClassName,
          )}
          style={
            {
              height: `${(h * 100).toFixed(2)}%`,
              "--kp-dur": `${(0.9 + seeded(i * 3.3) * 0.8).toFixed(2)}s`,
              "--kp-delay": `${(seeded(i * 1.7) * 0.5).toFixed(2)}s`,
              "--kp-peak": (1 + (1 - h) * 0.75).toFixed(2),
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
