"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/primitives/Icon";
import { trackEvent } from "@/lib/api";
import { KIDS } from "@/lib/content";
import { leadHref, openLeadForm, type LeadIntent } from "@/lib/leadIntent";
import { cn } from "@/lib/utils";

/**
 * A CTA that hands the lead form a preset before scrolling to it.
 *
 * The form lives on the home route, so this has to behave two ways and the
 * pathname is what decides which:
 *
 *   on `/`      the form is already mounted — broadcast the intent and scroll,
 *               which keeps the reader's place and needs no navigation.
 *   elsewhere   the form does not exist yet — link to it, carrying the intent
 *               in the URL for it to read on mount.
 *
 * A button would have been simpler, but a button that navigates between pages
 * is invisible to a crawler, and `/kids` exists to be crawled.
 */
export function LeadCta({
  label,
  intent,
  icon,
  event,
  section,
  element = "primary_cta",
  variant = "btn-violet",
  className,
}: {
  label: string;
  intent: LeadIntent;
  icon?: string;
  event: string;
  section: string;
  element?: string;
  variant?: "btn-violet" | "btn-primary" | "btn-ghost" | "btn-onnight";
  className?: string;
}) {
  const pathname = usePathname();
  const onHome = pathname === "/";

  const classes = cn("btn", variant, className);
  const body = (
    <>
      {icon && <Icon name={icon} className="size-[18px]" strokeWidth={1.9} />}
      {label}
    </>
  );

  function track() {
    trackEvent(event, section, element, {
      target: "lead-form",
      presetUserType: intent.userType,
      presetInterest: intent.interest,
    });
  }

  if (onHome) {
    return (
      <button
        type="button"
        className={cn(classes, "cursor-pointer")}
        onClick={() => {
          track();
          openLeadForm(intent);
        }}
      >
        {body}
      </button>
    );
  }

  return (
    <Link href={leadHref(intent)} className={classes} onClick={track}>
      {body}
    </Link>
  );
}

/** The home page's Kids section CTA, with its copy fixed. */
export function KidsCta({ className }: { className?: string }) {
  return (
    <LeadCta
      label={KIDS.cta.label}
      intent={{ userType: KIDS.cta.presetUserType, interest: KIDS.cta.presetInterest }}
      icon="baby"
      event="kids_cta_clicked"
      section="kids"
      className={className}
    />
  );
}
