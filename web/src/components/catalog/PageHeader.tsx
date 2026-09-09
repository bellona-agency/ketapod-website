import type { ReactNode } from "react";
import { Reveal, RevealGroup, RevealItem } from "@/components/primitives/Reveal";
import { Breadcrumbs, type Crumb } from "./Breadcrumbs";
import { JsonLd, breadcrumbLd } from "@/lib/seo";
import { cn } from "@/lib/utils";

/**
 * The masthead every non-home page opens with.
 *
 * One component rather than a hand-built header per route, for the same reason
 * `SectionHeading` exists on the home page: the distance from the fixed header,
 * the type scale of the `h1` and the width of the lead are page-level decisions,
 * and eleven routes each making them separately is how a site starts looking
 * like eleven sites.
 *
 * It also emits the breadcrumb structured data, from the same `trail` it draws —
 * a page cannot show one trail and claim another.
 */
export function PageHeader({
  trail,
  eyebrow,
  title,
  lead,
  aside,
  below,
  className,
}: {
  trail: Crumb[];
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  /** Sits opposite the title on desktop — counts, filters, a primary action. */
  aside?: ReactNode;
  /** Full-width row under the header: chips, a rail, a search field. */
  below?: ReactNode;
  className?: string;
}) {
  return (
    <header
      /* Top padding clears the fixed header, matching the home hero exactly.
         Trailing space is smaller than `.section-rhythm` on purpose: a masthead
         belongs to the content under it, not beside it. */
      className={cn("relative pt-24 sm:pt-32 md:pt-40", className)}
    >
      <div className="container-k">
        <Reveal amount={0.05}>
          <Breadcrumbs trail={trail} />
        </Reveal>

        <RevealGroup
          className="mt-6 flex flex-col gap-6 md:flex-row md:items-end md:justify-between md:gap-12"
          stagger={0.08}
          amount={0.05}
        >
          <RevealItem className="flex max-w-[42rem] flex-col gap-4">
            <span className="eyebrow">{eyebrow}</span>
            <h1 className="text-[30px] font-extrabold leading-[1.32] tracking-[-0.015em] text-ink sm:text-[40px] md:text-[48px]">
              {title}
            </h1>
            {lead && (
              <p className="max-w-[56ch] text-[17px] leading-[1.72] text-muted sm:text-[19px] sm:leading-[1.95]">
                {lead}
              </p>
            )}
          </RevealItem>

          {aside && <RevealItem className="shrink-0">{aside}</RevealItem>}
        </RevealGroup>

        {below && (
          <Reveal amount={0.05} className="mt-9">
            {below}
          </Reveal>
        )}
      </div>

      <JsonLd data={breadcrumbLd(trail)} />
    </header>
  );
}
