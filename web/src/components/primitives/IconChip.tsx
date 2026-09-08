import { Icon } from "./Icon";
import { cn } from "@/lib/utils";

/* One tone per surface, not per section mood — `paper` on the page, `night` on
   a dark panel, `violet` on the solid violet tile. There is deliberately no
   accent tone: a section that wants to feel different should say so with its
   content, not by recolouring the furniture. */
type Tone = "paper" | "night" | "violet";

const TONE: Record<Tone, string> = {
  paper: "chip-paper",
  night: "chip-night",
  violet: "chip-violet",
};

/**
 * The single icon container used across the page.
 *
 * It replaces four near-identical treatments that differed in size (40/44/64),
 * radius (`sm`/`md`) and ring colour — small differences, but four of them in a
 * row is exactly what makes a reader feel the sections were built separately.
 *
 * `tilt` opts the chip into the card's hover gesture; it needs a `group` ancestor.
 */
export function IconChip({
  name,
  tone = "paper",
  size = "md",
  tilt = false,
  className,
}: {
  name: string;
  tone?: Tone;
  size?: "sm" | "md";
  tilt?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn("chip", size === "sm" && "chip-sm", TONE[tone], tilt && "chip-tilt", className)}
    >
      <Icon name={name} className={size === "sm" ? "size-[19px]" : "size-5"} strokeWidth={1.7} />
    </span>
  );
}
