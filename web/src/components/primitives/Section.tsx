import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * `plain` — content sits directly on the page's paper.
 * `light` / `night` / `deep` — content sits inside a boxed panel.
 *
 * The three panels are deliberately one design at three brightnesses rather
 * than three designs: same radius, same padding scale, same atmosphere (a dot
 * grid and two wide washes), and all three on the violet ramp. Before this,
 * Problem, Kids and Final CTA each invented their own, which is most of why the
 * page read as separately-designed strips.
 */
export type Shell = "plain" | "light" | "night" | "deep";

const PANEL_SURFACE: Record<Exclude<Shell, "plain">, string> = {
  light:
    "bg-[linear-gradient(200deg,var(--color-violet-50)_0%,var(--color-paper)_50%,var(--color-violet-50)_100%)] ring-1 ring-inset ring-violet-100",
  night: "bg-night",
  deep: "bg-[linear-gradient(215deg,#1A1A5E_0%,#101140_48%,var(--color-night)_100%)]",
};

/** Wash pair per panel. Structure is identical; only the value moves. */
const PANEL_WASH: Record<Exclude<Shell, "plain">, [string, string]> = {
  light: [
    "bg-[radial-gradient(circle,rgba(42,56,255,0.16)_0%,transparent_68%)]",
    "bg-[radial-gradient(circle,rgba(110,120,255,0.20)_0%,transparent_70%)]",
  ],
  night: [
    "bg-[radial-gradient(circle,rgba(42,56,255,0.30)_0%,transparent_66%)]",
    "bg-[radial-gradient(circle,rgba(110,120,255,0.16)_0%,transparent_66%)]",
  ],
  deep: [
    "bg-[radial-gradient(circle,rgba(110,120,255,0.34)_0%,transparent_66%)]",
    "bg-[radial-gradient(circle,rgba(42,56,255,0.18)_0%,transparent_70%)]",
  ],
};

const DOTS: Record<Exclude<Shell, "plain">, string> = {
  light: "text-violet/[0.10]",
  night: "text-white/[0.05]",
  deep: "text-white/[0.06]",
};

/**
 * A page section. Handles the shared shell and the shared vertical rhythm
 * (`.section-rhythm` in `globals.css`), so no section can drift from the one
 * above it.
 */
export function Section({
  id,
  shell = "plain",
  children,
  decor,
  className,
  panelClassName,
  contained = true,
}: {
  id: string;
  shell?: Shell;
  children: ReactNode;
  /** Decoration pinned to the panel's own box, behind the content. */
  decor?: ReactNode;
  className?: string;
  panelClassName?: string;
  /** Off for sections that manage their own full-bleed layout. */
  contained?: boolean;
}) {
  const body =
    shell === "plain" ? (
      children
    ) : (
      <div className={cn("panel", PANEL_SURFACE[shell], panelClassName)}>
        <PanelAtmosphere shell={shell} />
        {decor}
        <div className="relative">{children}</div>
      </div>
    );

  return (
    <section id={id} className={cn("section-rhythm relative", className)}>
      {contained ? <div className="container-k">{body}</div> : body}
    </section>
  );
}

function PanelAtmosphere({ shell }: { shell: Exclude<Shell, "plain"> }) {
  const [a, b] = PANEL_WASH[shell];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className={cn("absolute -top-32 right-[12%] size-[460px] rounded-full", a)} />
      <div className={cn("absolute -bottom-40 left-[-6%] size-[420px] rounded-full", b)} />
      <div className={cn("dotgrid absolute inset-0", DOTS[shell])} />
    </div>
  );
}
