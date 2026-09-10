"use client";

import Link from "next/link";

import { formatDate, formatNumber, priorityColors, typeColors, typeGlyphs } from "@/lib/format";
import type { Issue } from "@/lib/types";

import { Avatar } from "./ui";

/** One line in a list — the backlog, search results, "my issues". The
    same information as a card, laid out to scan vertically. */
export function IssueRow({
  issue,
  draggable = false,
  dragging = false,
  onDragStart,
  onDragEnd,
}: {
  issue: Issue;
  draggable?: boolean;
  dragging?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const overdue =
    issue.dueAt && issue.status.category !== "done" && new Date(issue.dueAt) < new Date();

  return (
    <Link
      href={`/issue/${issue.key}`}
      draggable={draggable}
      onDragStart={(event) => {
        if (!draggable) return;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", issue.id);
        onDragStart?.();
      }}
      onDragEnd={onDragEnd}
      className={`flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-surface-2 ${
        dragging ? "opacity-40" : ""
      } ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <span aria-hidden style={{ color: typeColors[issue.type] }}>
        {typeGlyphs[issue.type]}
      </span>
      <span className="latin w-20 shrink-0 text-[12px] text-muted">{issue.key}</span>

      <span
        className={`min-w-0 flex-1 truncate text-[13px] ${
          issue.status.category === "done" ? "text-muted line-through" : "text-ink"
        }`}
      >
        {issue.title}
      </span>

      {issue.labels.slice(0, 3).map((label) => (
        <span
          key={label.id}
          style={{ color: label.color, borderColor: `${label.color}55` }}
          className="hidden shrink-0 rounded border px-1 text-[10px] font-semibold sm:inline"
        >
          {label.name}
        </span>
      ))}

      {overdue && (
        <span className="shrink-0 text-[11px] text-clay" title={`مهلت ${formatDate(issue.dueAt)}`}>
          ⏱
        </span>
      )}

      <span aria-hidden style={{ color: priorityColors[issue.priority] }} className="shrink-0 text-[11px]">
        {issue.priority === "highest" || issue.priority === "high" ? "▲" : ""}
        {issue.priority === "low" || issue.priority === "lowest" ? "▼" : ""}
      </span>

      {issue.storyPoints != null && (
        <span className="shrink-0 rounded-full border border-line-strong px-1.5 text-[10px] font-bold text-ink-2">
          {formatNumber(issue.storyPoints)}
        </span>
      )}

      <span className="hidden w-24 shrink-0 truncate text-[11px] text-muted sm:block">
        {issue.status.name}
      </span>
      <Avatar member={issue.assignee} size={22} />
    </Link>
  );
}
