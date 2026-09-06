"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { trackEvent } from "@/lib/api";
import { openLeadForm, type LeadIntent } from "@/lib/leadIntent";
import { cn, scrollToSection } from "@/lib/utils";

type Variant = "primary" | "violet" | "ghost" | "onnight";

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "btn-primary",
  violet: "btn-violet",
  ghost: "btn-ghost",
  onnight: "btn-onnight",
};

type Common = {
  label: string;
  variant?: Variant;
  event: string;
  section: string;
  element?: string;
  arrow?: boolean;
  icon?: ReactNode;
  className?: string;
  metadata?: Record<string, unknown>;
};

/** Scrolls to an element on the current page. */
type ScrollCta = Common & { target: string; href?: never; intent?: LeadIntent };

/** Navigates to another route. */
type LinkCta = Common & { href: string; target?: never; intent?: never };

export type CtaProps = ScrollCta | LinkCta;

/* An explicit guard rather than an inline `props.href !== undefined`. The two
   members are distinguished by an optional `never`, and narrowing on that is
   subtle enough that a future edit could quietly break it; a predicate states
   the intent and fails loudly instead. */
const isLinkCta = (props: CtaProps): props is LinkCta => typeof props.href === "string";

/**
 * A call-to-action, in the two shapes this site needs.
 *
 * `target` — an element id on the current page. Scrolls to it, and when that id
 * is the lead form, hands it a preset first (Kids → parent). This is the home
 * page's whole navigation model.
 *
 * `href` — a real route. Now that the catalogue, kids, assistant and dialect
 * pages exist, most CTAs point across pages rather than down one, and those
 * must be anchors: a button that pushes history is invisible to a crawler, and
 * the spec makes indexability the reason the web surface exists at all.
 *
 * Both spellings fire the same analytics event, so a funnel does not change
 * shape just because a section moved onto its own page.
 */
export function Cta(props: CtaProps) {
  const {
    label,
    variant = "primary",
    event,
    section,
    element = "primary_cta",
    arrow = true,
    icon,
    className,
    metadata,
  } = props;

  const content = (
    <>
      {icon}
      <span>{label}</span>
      {arrow && (
        <ArrowLeft
          className="size-4 transition-transform duration-300 group-hover:-translate-x-1"
          strokeWidth={2}
          aria-hidden
        />
      )}
    </>
  );

  const classes = cn("btn group", VARIANT_CLASS[variant], className);

  if (isLinkCta(props)) {
    const { href } = props;
    return (
      <Link
        href={href}
        className={classes}
        onClick={() => trackEvent(event, section, element, { target: href, label, ...metadata })}
      >
        {content}
      </Link>
    );
  }

  const { target, intent } = props;

  function handleClick() {
    trackEvent(event, section, element, { target, label, ...metadata });
    if (target === "lead-form") openLeadForm(intent ?? {});
    else scrollToSection(target);
  }

  return (
    <button type="button" onClick={handleClick} className={classes}>
      {content}
    </button>
  );
}
