"use client";

import Link from "next/link";

import { formatNumber, priorityColors, priorityLabels, typeColors, typeGlyphs } from "@/lib/format";
import type { Issue } from "@/lib/types";

import { Avatar } from "./ui";

/**
 * One card on the board.
 *
 * What is on it is the result of subtraction, not addition: type, key,
 * title, labels, points, assignee. Everything else — reporter, dates,
 * description, comment counts beyond a dot — is on the issue page.
 * A card that carries everything makes a board you have to read instead
 * of scan, and scanning is the only thing a board is for.
 */
export function IssueCard({
  issue,
  draggable = false,
  onDragStart,
  onDragEnd,
  dragging = false,
}: {
  issue: Issue;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  dragging?: boolean;
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
        // Firefox refuses to start a drag without payload, and the id is
        // enough for the drop handler to identify the card.
        event.dataTransfer.setData("text/plain", issue.id);
        onDragStart?.();
      }}
      onDragEnd={onDragEnd}
      className={`block rounded-[var(--radius-card)] border border-line bg-surface-2 p-2.5 transition-colors hover:border-line-strong ${
        dragging ? "opacity-40" : ""
      } ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <p className="mb-1.5 line-clamp-3 text-[13px] leading-relaxed text-ink">{issue.title}</p>

      {issue.labels.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {issue.labels.map((label) => (
            <span
              key={label.id}
              style={{ color: label.color, borderColor: `${label.color}55` }}
              className="rounded border px-1 text-[10px] font-semibold"
            >
              {label.name}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1.5 text-[11px] text-muted">
        <span aria-hidden title={issue.type} style={{ color: typeColors[issue.type] }}>
          {typeGlyphs[issue.type]}
        </span>
        <span className="latin">{issue.key}</span>

        <span
          title={`اولویت: ${priorityLabels[issue.priority]}`}
          style={{ color: priorityColors[issue.priority] }}
          aria-hidden
        >
          {issue.priority === "highest" || issue.priority === "high" ? "▲" : ""}
          {issue.priority === "low" || issue.priority === "lowest" ? "▼" : ""}
        </span>

        {issue.commentCount > 0 && (
          <span title="کامنت">⌯{formatNumber(issue.commentCount)}</span>
        )}
        {issue.subtaskCount > 0 && <span title="زیرتسک">⊞{formatNumber(issue.subtaskCount)}</span>}
        {overdue && (
          <span className="text-clay" title="از مهلت گذشته">
            ⏱
          </span>
        )}

        <span className="mr-auto flex items-center gap-1.5">
          {issue.storyPoints != null && (
            <span className="rounded-full border border-line-strong px-1.5 text-[10px] font-bold text-ink-2">
              {formatNumber(issue.storyPoints)}
            </span>
          )}
          <Avatar member={issue.assignee} size={20} />
        </span>
      </div>
    </Link>
  );
}
