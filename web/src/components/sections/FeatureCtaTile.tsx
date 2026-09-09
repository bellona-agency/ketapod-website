"use client";

import { ArrowLeft } from "lucide-react";
import { trackEvent } from "@/lib/api";
import { PRIMARY_CTA_LABEL } from "@/lib/content";
import { openLeadForm } from "@/lib/leadIntent";

/**
 * The bento's twelfth cell.
 *
 * Split into its own file so the rest of the Features section can stay a server
 * component — this button is the only thing in it that needs a click handler.
 */
export function FeatureCtaTile() {
  return (
    <button
      type="button"
      onClick={() => {
        trackEvent("final_cta_clicked", "features", "grid_cta", { target: "lead-form" });
        openLeadForm();
      }}
      className="group lift flex h-full w-full cursor-pointer flex-col justify-between rounded-lg border border-dashed border-line-2 bg-transparent p-6 text-right transition-[border-color,background-color,transform] duration-300 hover:border-violet hover:bg-violet-50"
    >
      <span className="grid size-11 place-items-center rounded-full border border-line-2 text-ink transition-colors duration-300 group-hover:border-violet group-hover:bg-violet group-hover:text-white">
        <ArrowLeft className="size-4" strokeWidth={2} aria-hidden />
      </span>
      <span className="mt-6 block">
        <span className="block text-[18px] font-bold text-ink">{PRIMARY_CTA_LABEL}</span>
        <span className="mt-1.5 block text-[16px] leading-relaxed text-muted">
          همه امکانات را از داخل محصول ببین.
        </span>
      </span>
    </button>
  );
}
