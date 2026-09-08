"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

/** Brand blues, straight from the logo sheet. */
const GRADIENT = ["#9AA2FF", "#6E78FF", "#2A38FF"] as const;

/**
 * The logo mark: headphones over an open book, with the waveform between them.
 *
 * Redrawn as vector rather than dropped in as the supplied render — it appears
 * at 30px in the header, where a raster would go to mush, and as paths the
 * waveform bars can pick up the same entrance beat as the rest of the page.
 */
export function BrandIcon({
  className,
  style,
  tone = "brand",
  animated = true,
}: {
  className?: string;
  style?: React.CSSProperties;
  /** `brand` paints the gradient; `mono` inherits `currentColor`. */
  tone?: "brand" | "mono";
  animated?: boolean;
}) {
  const gid = useId();
  const paint = tone === "mono" ? "currentColor" : `url(#${gid})`;
  const bars = [9, 15, 23, 31, 37, 29, 21, 14, 9];

  return (
    <svg
      viewBox="0 0 64 64"
      style={style}
      className={cn("shrink-0", className)}
      role="img"
      aria-label="کتاپاد"
    >
      {tone === "brand" && (
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={GRADIENT[0]} />
            <stop offset="52%" stopColor={GRADIENT[1]} />
            <stop offset="100%" stopColor={GRADIENT[2]} />
          </linearGradient>
        </defs>
      )}

      <g
        stroke={paint}
        fill="none"
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* headband */}
        <path d="M13 36.5V29a19 19 0 0 1 38 0v7.5" />
        {/*
          Open book. Each page is traced down its outer edge, across to the
          spine, and back up the inner edge — the double contour is what reads
          as a block of pages rather than a plain chevron.
        */}
        <path d="M10 39.5v11.2c0 3.4 5.8 6 22 12.3v-6.2c-11.6-4.6-15.6-6.8-15.6-9.2V39.5" />
        <path d="M54 39.5v11.2c0 3.4-5.8 6-22 12.3v-6.2c11.6-4.6 15.6-6.8 15.6-9.2V39.5" />
      </g>

      {/* ear cups */}
      <g fill={paint}>
        <rect x="6.5" y="32" width="9" height="13.5" rx="4.5" />
        <rect x="48.5" y="32" width="9" height="13.5" rx="4.5" />
      </g>

      {/* waveform */}
      <g fill={paint}>
        {/* The entrance is the `kp-bar-in` keyframe — a compositor animation
            with a per-bar delay, rather than nine motion instances. */}
        {bars.map((h, i) => (
          <rect
            key={i}
            x={21 + i * 2.8}
            y={34.5 - h / 2}
            width="2.1"
            height={h}
            rx="1.05"
            className={animated ? "kp-bar-in" : undefined}
            style={
              animated
                ? ({ "--kp-delay": `${(0.04 * i).toFixed(2)}s` } as React.CSSProperties)
                : undefined
            }
          />
        ))}
      </g>
    </svg>
  );
}

/**
 * The Persian wordmark.
 *
 * Rendered as a CSS mask rather than an `<img>`, so the lettering takes
 * `currentColor` — the same file reads as ink on the paper header and as white
 * on the night footer, with no second asset and no colour baked in.
 */
export function BrandWord({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      role="img"
      aria-label="کتاپاد"
      className={cn("block bg-current", className)}
      style={{
        aspectRatio: "2440 / 934",
        maskImage: "url(/assets/wordmark.png)",
        WebkitMaskImage: "url(/assets/wordmark.png)",
        maskSize: "contain",
        WebkitMaskSize: "contain",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskPosition: "center",
        ...style,
      }}
    />
  );
}

/**
 * Mark + wordmark. `size` is the mark's box in px; the wordmark is set to ~68%
 * of it so the lettering's x-height optically matches the icon rather than
 * measuring the same, which would make the word look oversized next to it.
 */
export function BrandMark({
  className,
  tone = "paper",
  showWord = true,
  animated = true,
  size = 34,
}: {
  className?: string;
  tone?: "paper" | "night";
  showWord?: boolean;
  animated?: boolean;
  size?: number;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandIcon animated={animated} className="shrink-0" style={{ width: size, height: size }} />
      {showWord && (
        <BrandWord
          className={tone === "night" ? "text-white" : "text-ink"}
          style={{ height: Math.round(size * 0.68) }}
        />
      )}
    </span>
  );
}
