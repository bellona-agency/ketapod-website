import Image from "next/image";
import { cn } from "@/lib/utils";

/*
 * Real bookshelves are not monochrome, so these stay varied on purpose — but
 * index 0 is the cover in the hero mockup, the most-looked-at image on the
 * page. It carries the brand blue so the product shot agrees with the UI
 * around it; the rest are free to be other books.
 */
const PALETTES = [
  { a: "#2A38FF", b: "#9AA2FF", c: "#F3D9A4", d: "#0B0F2A" },
  { a: "#1F6F55", b: "#5FCBA0", c: "#F5E6C8", d: "#0C2219" },
  { a: "#9A3B2F", b: "#E89B7B", c: "#FBE6CD", d: "#2D110D" },
  { a: "#2B3A67", b: "#7E93D4", c: "#EBD9B4", d: "#0F1730" },
  { a: "#6B2D5B", b: "#C97BAE", c: "#F6D9E6", d: "#250E20" },
  { a: "#8A5A12", b: "#E7B45C", c: "#FCEDD3", d: "#2A1806" },
];

/**
 * Stand-in book cover.
 *
 * Real covers arrive from `coverUrl`; until then this draws a small landscape
 * scene from a fixed palette per index. It's deterministic, weighs nothing, and
 * keeps the player mockups looking like a product instead of a wireframe.
 */
export function CoverArt({
  src,
  alt,
  index = 0,
  className,
  rounded = "rounded-md",
  sizes = "220px",
}: {
  src?: string;
  alt: string;
  index?: number;
  className?: string;
  rounded?: string;
  sizes?: string;
}) {
  if (src) {
    return (
      <div className={cn("relative overflow-hidden", rounded, className)}>
        <Image src={src} alt={alt} fill sizes={sizes} className="object-cover" />
      </div>
    );
  }

  const p = PALETTES[index % PALETTES.length];

  const gid = `cv${index}`;

  return (
    <div
      className={cn("relative overflow-hidden", rounded, className)}
      role="img"
      aria-label={alt}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full" aria-hidden>
        <defs>
          <linearGradient id={`${gid}-sky`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={p.d} />
            <stop offset="55%" stopColor={p.a} />
            <stop offset="100%" stopColor={p.b} />
          </linearGradient>
        </defs>
        <rect width="100" height="100" fill={`url(#${gid}-sky)`} />
        {/* moon */}
        <circle cx={68 + (index % 3) * 6} cy={26} r={9} fill={p.c} opacity="0.92" />
        {/* stars */}
        {[
          [18, 18],
          [30, 32],
          [46, 14],
          [84, 46],
          [12, 44],
        ].map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r={i % 2 ? 0.8 : 1.2} fill={p.c} opacity="0.7" />
        ))}
        {/* ridges */}
        <path
          d={`M0 ${74 + (index % 3) * 3} L26 56 L44 72 L62 52 L82 70 L100 60 L100 100 L0 100 Z`}
          fill={p.d}
          opacity="0.88"
        />
        <path
          d="M0 84 L22 70 L40 84 L58 68 L78 86 L100 76 L100 100 L0 100 Z"
          fill="#000"
          opacity="0.35"
        />
      </svg>
      <div className="absolute inset-0 ring-1 ring-inset ring-black/10" />
    </div>
  );
}
