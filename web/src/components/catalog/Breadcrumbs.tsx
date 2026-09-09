import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type Crumb = { name: string; path: string };

/**
 * The visible half of the breadcrumb trail; `breadcrumbLd` in `lib/seo` emits
 * the machine-readable half from the same array, so the two can never disagree.
 *
 * The last crumb is the current page and is deliberately not a link — a link to
 * where you already are is noise for a reader and a self-reference for a
 * crawler. It carries `aria-current` instead.
 */
export function Breadcrumbs({ trail, tone = "paper" }: { trail: Crumb[]; tone?: "paper" | "night" }) {
  const night = tone === "night";

  return (
    <nav aria-label="مسیر صفحه">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[14px]">
        {trail.map((crumb, i) => {
          const last = i === trail.length - 1;
          return (
            <li key={crumb.path} className="flex items-center gap-1.5">
              {last ? (
                <span
                  aria-current="page"
                  className={cn("font-medium", night ? "text-night-ink" : "text-ink-2")}
                >
                  {crumb.name}
                </span>
              ) : (
                <Link
                  href={crumb.path}
                  className={cn(
                    "transition-colors duration-200",
                    night ? "text-night-muted hover:text-white" : "text-muted hover:text-violet",
                  )}
                >
                  {crumb.name}
                </Link>
              )}

              {/* RTL page: the separator points the way the trail runs. */}
              {!last && (
                <ChevronLeft
                  className={cn("size-3.5 shrink-0", night ? "text-night-line" : "text-faint")}
                  strokeWidth={2}
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
