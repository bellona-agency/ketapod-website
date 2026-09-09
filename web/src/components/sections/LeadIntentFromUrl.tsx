"use client";

import { useEffect } from "react";
import { intentFromLocation, openLeadForm } from "@/lib/leadIntent";

/**
 * Turns `/?lead_u=parent&lead_i=kids#lead-form` into a lead-form preset.
 *
 * A CTA on `/kids` or `/ai` cannot broadcast to the form directly — the form
 * lives on this route and does not exist yet when that CTA is clicked. So the
 * intent travels in the URL, and this reads it back on arrival and puts it into
 * the same channel a same-page CTA would use.
 *
 * It is its own component rather than an effect inside the form because the
 * form must not call `setState` synchronously from an effect body. Here the
 * effect only notifies an external subscriber; the form's own state changes
 * happen inside its subscription callback, which is where they belong. The
 * channel replays a pending intent on subscribe, so it does not matter whether
 * this mounts before or after the form.
 *
 * Renders nothing.
 */
export function LeadIntentFromUrl() {
  useEffect(() => {
    const intent = intentFromLocation(window.location.search);
    if (intent) openLeadForm(intent);
  }, []);

  return null;
}
