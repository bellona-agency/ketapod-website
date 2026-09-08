"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Seamless ticker.
 *
 * The track holds two identical copies and slides exactly half its width, so
 * the loop point is invisible.
 *
 * The slide is a CSS keyframe rather than a JS animation: an endless translate
 * driven from the main thread writes an inline transform every frame and
 * competes with scrolling, which is the last thing a decorative strip should
 * do. It also only runs while on screen, and stops entirely under reduced
 * motion — an infinite marquee is exactly what that setting exists to stop.
 */
export function Marquee({
  children,
  speed = 34,
  reverse = false,
  className,
  fade = true,
}: {
  children: ReactNode;
  /** Seconds for one full cycle. Higher = slower. */
  speed?: number;
  reverse?: boolean;
  className?: string;
  fade?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setOnScreen(entry.isIntersecting),
      { rootMargin: "100px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const track = (
    <div className="flex shrink-0 items-center gap-3 pl-3">{children}</div>
  );

  return (
    <div
      ref={ref}
      className={cn("relative overflow-hidden", onScreen && "kp-marquee-on", className)}
      style={
        fade
          ? {
              maskImage:
                "linear-gradient(to left, transparent, black 8%, black 92%, transparent)",
              WebkitMaskImage:
                "linear-gradient(to left, transparent, black 8%, black 92%, transparent)",
            }
          : undefined
      }
      aria-hidden
    >
      <div
        className="kp-marquee-track flex w-max"
        data-reverse={reverse ? "true" : undefined}
        style={{ "--kp-speed": `${speed}s` } as React.CSSProperties}
      >
        {track}
        {track}
      </div>
    </div>
  );
}
