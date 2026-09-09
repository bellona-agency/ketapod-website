import type { CSSProperties, ReactNode } from "react";
import { RevealGroup, RevealItem } from "./Reveal";
import { cn } from "@/lib/utils";

type Tone = "paper" | "night";

/**
 * The page's editorial signature: a mono index, a rule that draws itself, then
 * the Persian headline.
 *
 * Every section goes through this — including the Final CTA, which used to
 * hand-roll its own eyebrow and an `h2` two steps larger than everywhere else.
 * One component means the type scale can only ever have one value.
 */
export function SectionHeading({
  index,
  eyebrow,
  title,
  lead,
  align = "start",
  split = false,
  tone = "paper",
  className,
  titleClassName,
  action,
}: {
  index: string;
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  align?: "start" | "center";
  /**
   * Set when the heading owns a full-width row.
   *
   * On desktop the title and the lead then sit side by side instead of
   * stacking, which is what left a wide empty band above the content of every
   * full-width section — the title stops at 19ch and the lead at 52ch, so
   * nearly half of a 1216px row was blank.
   *
   * Off by default because most headings here sit inside a column of a larger
   * grid (Kids, Localization, the lead form, the player) and are already too
   * narrow to divide again.
   */
  split?: boolean;
  tone?: Tone;
  className?: string;
  titleClassName?: string;
  action?: ReactNode;
}) {
  const centered = align === "center";
  const night = tone === "night";
  const twoUp = split && !centered;

  return (
    <RevealGroup
      stagger={0.08}
      amount={0.4}
      className={cn(
        "flex flex-col gap-5",
        centered ? "items-center text-center" : "items-start",
        twoUp && "md:grid md:grid-cols-2 md:items-end md:gap-x-12 md:gap-y-0",
        /* The old single-column layout still parks a lone action at the far
           end of the row. */
        !twoUp && !!action && !centered && "md:flex-row md:items-end md:justify-between md:gap-10",
        className,
      )}
    >
      <RevealItem className={cn("flex flex-col gap-4", centered && "items-center")}>
        <div className={cn("eyebrow", night && "text-night-muted")}>
          <span className="tnum text-[15px] tracking-normal">{index}</span>
          <span
            aria-hidden
            className={cn("kp-reveal block h-px w-10", night ? "bg-night-line" : "bg-line-2")}
            data-v="rule"
            style={{ "--kp-rd": "0.18s" } as CSSProperties}
          />
          <span>{eyebrow}</span>
        </div>

        <h2
          className={cn(
            "max-w-[19ch] text-[27px] font-bold sm:text-[34px] md:text-[42px]",
            night ? "text-night-ink" : "text-ink",
            centered && "max-w-[24ch]",
            /* In its own column the headline may use the whole of it. */
            twoUp && "md:max-w-none",
            titleClassName,
          )}
        >
          {title}
        </h2>

        {/* Single-column: the lead follows the title, as it always did. */}
        {lead && !twoUp && (
          <p
            className={cn(
              "max-w-[52ch] text-[17px] leading-[1.72] sm:leading-[1.95] sm:text-[19px]",
              night ? "text-night-muted" : "text-muted",
            )}
          >
            {lead}
          </p>
        )}
      </RevealItem>

      {/* Two-column: the lead is the second column, and any action sits under
          it rather than alone at the end of an otherwise empty row. */}
      {twoUp && (lead || action) && (
        <RevealItem className="flex flex-col items-start gap-6">
          {lead && (
            <p
              className={cn(
                "max-w-[52ch] text-[17px] leading-[1.72] sm:leading-[1.95] sm:text-[19px]",
                night ? "text-night-muted" : "text-muted",
              )}
            >
              {lead}
            </p>
          )}
          {/* Pinned to the column's outer edge, which is where the action sat
              before it moved out of its own row. */}
          {action && <div className="self-start md:self-end">{action}</div>}
        </RevealItem>
      )}

      {!twoUp && action && (
        <RevealItem className={cn("shrink-0", !centered && "self-start")}>{action}</RevealItem>
      )}
    </RevealGroup>
  );
}
