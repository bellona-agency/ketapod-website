"use client";

import { formatNumber } from "@/lib/format";
import type { BurndownPoint, VelocityEntry } from "@/lib/types";

/**
 * The charts are hand-drawn SVG.
 *
 * Two charts, both simple, against a charting library that would be
 * 60-plus kilobytes on a screen the team opens once a sprint. The
 * tradeoff would be different if there were ten of them or if anyone
 * needed zoom and brush; there are two and nobody does.
 */

const chartWidth = 640;
const chartHeight = 200;
const padding = { top: 12, right: 12, bottom: 24, left: 34 };

export function BurndownChart({ points }: { points: BurndownPoint[] }) {
  if (points.length < 2) {
    return <p className="py-8 text-center text-[13px] text-muted">داده کافی برای نمودار نیست</p>;
  }

  const max = Math.max(...points.map((p) => Math.max(p.scope, p.ideal)), 1);
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  // RTL: day one on the right, today on the left, so the chart reads in
  // the same direction as the page.
  const x = (index: number) =>
    padding.left + innerWidth - (index / (points.length - 1)) * innerWidth;
  const y = (value: number) => padding.top + innerHeight - (value / max) * innerHeight;

  const line = (pick: (point: BurndownPoint) => number) =>
    points.map((point, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(pick(point))}`).join(" ");

  return (
    <svg
      viewBox={`0 0 ${chartWidth} ${chartHeight}`}
      className="w-full"
      role="img"
      aria-label="نمودار برن‌داون"
    >
      {[0, 0.5, 1].map((fraction) => (
        <g key={fraction}>
          <line
            x1={padding.left}
            x2={chartWidth - padding.right}
            y1={y(max * fraction)}
            y2={y(max * fraction)}
            stroke="var(--color-line)"
          />
          <text
            x={padding.left - 6}
            y={y(max * fraction) + 4}
            textAnchor="end"
            className="fill-[var(--color-muted)] text-[9px]"
          >
            {formatNumber(Math.round(max * fraction))}
          </text>
        </g>
      ))}

      {/* Scope first, so a rising scope line sits behind the work done. */}
      <path d={line((p) => p.scope)} fill="none" stroke="var(--color-ember)" strokeWidth="1.5" strokeDasharray="2 3" />
      <path d={line((p) => p.ideal)} fill="none" stroke="var(--color-muted)" strokeWidth="1" strokeDasharray="4 4" />
      <path d={line((p) => p.remaining)} fill="none" stroke="var(--color-accent)" strokeWidth="2" />

      {points.map((point, index) => (
        <circle key={point.date} cx={x(index)} cy={y(point.remaining)} r="2.5" fill="var(--color-accent)">
          <title>
            {point.date}: {formatNumber(point.remaining)} مانده از {formatNumber(point.scope)}
          </title>
        </circle>
      ))}

      <text x={chartWidth - padding.right} y={chartHeight - 6} textAnchor="end" className="fill-[var(--color-muted)] text-[9px]">
        {points[0].date}
      </text>
      <text x={padding.left} y={chartHeight - 6} textAnchor="start" className="fill-[var(--color-muted)] text-[9px]">
        {points[points.length - 1].date}
      </text>
    </svg>
  );
}

export function VelocityChart({ entries }: { entries: VelocityEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="py-8 text-center text-[13px] text-muted">
        هنوز اسپرینت بسته‌شده‌ای نیست. ولاسیتی بعد از بستن اولین اسپرینت معنا پیدا می‌کند.
      </p>
    );
  }

  const max = Math.max(...entries.flatMap((entry) => [entry.committed, entry.completed]), 1);
  const innerHeight = chartHeight - padding.top - padding.bottom;

  return (
    <div className="flex items-end justify-around gap-3 overflow-x-auto" style={{ height: chartHeight }}>
      {entries.map((entry) => (
        <div key={entry.sprintId} className="flex min-w-16 flex-1 flex-col items-center gap-1">
          <div className="flex h-full w-full items-end justify-center gap-1">
            <div
              title={`تعهدشده: ${formatNumber(entry.committed)}`}
              style={{ height: `${(entry.committed / max) * innerHeight}px` }}
              className="w-1/2 rounded-t bg-line-strong"
            />
            <div
              title={`انجام‌شده: ${formatNumber(entry.completed)}`}
              style={{ height: `${(entry.completed / max) * innerHeight}px` }}
              className="w-1/2 rounded-t bg-accent"
            />
          </div>
          <span className="max-w-full truncate text-[11px] text-muted" title={entry.sprintName}>
            {entry.sprintName}
          </span>
        </div>
      ))}
    </div>
  );
}
