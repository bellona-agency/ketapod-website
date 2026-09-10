"use client";

import { useState } from "react";

import { formatDate, priorityLabels, timeAgo, typeLabels } from "@/lib/format";
import type { Activity } from "@/lib/types";

import { Avatar } from "./ui";

/**
 * The history, in sentences rather than a diff table.
 *
 * Ids are never shown. The server stores a human label alongside every
 * id-valued change for exactly this — "وضعیت را از بازبینی به انجام شد
 * برد" still reads correctly after the column has been renamed or
 * deleted, which a lookup against the current board would not.
 */
export function ActivityFeed({ activity }: { activity: Activity[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? activity : activity.slice(0, 6);

  if (activity.length === 0) return null;

  return (
    <section>
      <h2 className="mb-2 text-[12px] font-bold tracking-wide text-muted">تاریخچه</h2>
      <div className="space-y-1.5">
        {shown.map((entry) => (
          <div key={entry.id} className="flex items-start gap-2 text-[12px] text-ink-2">
            <Avatar member={entry.actor} size={18} />
            <p className="flex-1">
              <span className="font-semibold text-ink">{entry.actor?.fullName ?? "سیستم"}</span>{" "}
              {describe(entry)}
              <span className="text-muted"> · {timeAgo(entry.createdAt)}</span>
            </p>
          </div>
        ))}
      </div>

      {activity.length > 6 && (
        <button
          onClick={() => setExpanded((value) => !value)}
          className="mt-2 text-[12px] text-accent transition-opacity hover:opacity-80"
        >
          {expanded ? "کمتر" : `نمایش همه (${activity.length})`}
        </button>
      )}
    </section>
  );
}

function describe(entry: Activity): string {
  const from = entry.oldLabel || entry.oldValue;
  const to = entry.newLabel || entry.newValue;

  switch (entry.field) {
    case "created":
      return "این ایشیو را ساخت";
    case "status":
      return from ? `وضعیت را از «${from}» به «${to}» برد` : `وضعیت را روی «${to}» گذاشت`;
    case "assignee":
      return to ? "مسئول را عوض کرد" : `مسئول را برداشت${from ? ` (${from})` : ""}`;
    case "sprint":
      return to ? "به یک اسپرینت منتقل کرد" : "از اسپرینت بیرون آورد";
    case "epic":
      return to ? "زیر یک اپیک برد" : "از اپیک بیرون آورد";
    case "parent":
      return to ? "والد را تغییر داد" : "والد را برداشت";
    case "priority":
      return `اولویت را از «${priorityLabels[from ?? ""] ?? from}» به «${priorityLabels[to ?? ""] ?? to}» برد`;
    case "type":
      return `نوع را به «${typeLabels[to ?? ""] ?? to}» تغییر داد`;
    case "points":
      return to ? `امتیاز را روی ${to} گذاشت` : "امتیاز را برداشت";
    case "due":
      return to ? `مهلت را روی ${formatDate(to)} گذاشت` : "مهلت را برداشت";
    case "title":
      return "عنوان را ویرایش کرد";
    case "description":
      return "توضیح را ویرایش کرد";
    case "labels":
      return "برچسب‌ها را عوض کرد";
    default:
      return `«${entry.field}» را تغییر داد`;
  }
}
