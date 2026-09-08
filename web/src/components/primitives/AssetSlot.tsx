import Image from "next/image";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/* Only what the page actually uses. The amber tone went with the amber kids
   section; leaving it here would just be a one-prop route back to the
   inconsistency. */
type Tone = "violet" | "mint" | "night";

const TONES: Record<Tone, { wash: string; ink: string; ring: string }> = {
  violet: {
    wash: "bg-[radial-gradient(120%_90%_at_70%_20%,#efe9ff_0%,#f8f5ff_55%,#f7f8fc_100%)]",
    ink: "text-violet-700",
    ring: "ring-violet-200/70",
  },
  mint: {
    wash: "bg-[radial-gradient(120%_90%_at_70%_20%,#ddf1e8_0%,#f1f9f5_55%,#f7f8fc_100%)]",
    ink: "text-mint-ink",
    ring: "ring-mint-100",
  },
  night: {
    wash: "bg-[radial-gradient(120%_90%_at_70%_20%,#2a2440_0%,#1d1a2a_60%,#14121c_100%)]",
    ink: "text-violet-200",
    ring: "ring-white/10",
  },
};

/**
 * Reserved space for the 3D renders that get dropped in later.
 *
 * Until `src` arrives it renders a deliberate placeholder — labelled, ratio-
 * locked, on-palette — rather than an empty box, so the layout never shifts
 * when the real art lands (`content-jumping`, and it keeps the page reviewable
 * before the assets exist).
 */
export function AssetSlot({
  src,
  alt,
  label,
  ratio = "1 / 1",
  tone = "violet",
  className,
  imageClassName,
  rounded = "rounded-xl",
  children,
  priority = false,
  sizes = "(max-width: 768px) 90vw, 520px",
}: {
  src?: string;
  alt: string;
  /** Shown on the placeholder so the design brief is legible in the layout. */
  label: string;
  ratio?: string;
  tone?: Tone;
  className?: string;
  imageClassName?: string;
  rounded?: string;
  children?: ReactNode;
  priority?: boolean;
  sizes?: string;
}) {
  const t = TONES[tone];

  if (src) {
    return (
      <div
        className={cn("relative overflow-hidden", rounded, className)}
        style={{ aspectRatio: ratio }}
      >
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          className={cn("object-contain", imageClassName)}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative grid place-items-center overflow-hidden ring-1 ring-inset",
        t.wash,
        t.ring,
        rounded,
        className,
      )}
      style={{ aspectRatio: ratio }}
      role="img"
      aria-label={alt}
    >
      <div
        className={cn("pointer-events-none absolute inset-0 hatch opacity-45", t.ink)}
      />
      <div className="relative flex flex-col items-center gap-2 px-4 text-center">
        {children}
        <span
          className={cn(
            "tnum rounded-full px-2.5 py-1 text-[13px] font-medium tracking-[0.12em] uppercase",
            tone === "night" ? "bg-white/10" : "bg-white/70",
            t.ink,
          )}
        >
          3D asset
        </span>
        <span
          className={cn(
            "max-w-[22ch] text-[13px] leading-relaxed",
            tone === "night" ? "text-night-muted" : "text-muted",
          )}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

/**
 * Idle drift for decorative objects. Small amplitude, long period — enough to
 * keep the composition alive without ever pulling focus from the copy.
 *
 * Driven by a CSS keyframe so it runs on the compositor; the per-instance
 * amplitude, period and delay ride in as custom properties, set once.
 */
export function Float({
  children,
  className,
  amplitude = 10,
  duration = 6,
  delay = 0,
  rotate = 0,
}: {
  children: ReactNode;
  className?: string;
  amplitude?: number;
  duration?: number;
  delay?: number;
  rotate?: number;
}) {
  return (
    <div
      className={cn("kp-float", className)}
      style={
        {
          "--kp-amp": `${amplitude}px`,
          "--kp-dur": `${duration}s`,
          "--kp-delay": `${delay}s`,
          "--kp-rot": `${rotate}deg`,
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}
