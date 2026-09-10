"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { query } from "@/lib/api";
import { formatDate, formatDuration, toDateInput } from "@/lib/format";
import { useResource } from "@/lib/hooks";
import type { Worklog } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Card, EmptyState, Input, Skeleton } from "@/components/ui";

/** My logged time over a date range, grouped by day. Time is logged on
    the issue page; this is where it is read back. */
export default function TimesheetPage() {
  // Lazy initialisers: reading the clock during render makes a
  // component that renders differently on every render, which is what
  // the purity rule is for. Once, on mount, is the whole intent.
  const [from, setFrom] = useState(() =>
    toDateInput(new Date(Date.now() - 7 * 86400000).toISOString()),
  );
  const [to, setTo] = useState(() =>
    toDateInput(new Date(Date.now() + 86400000).toISOString()),
  );

  const sheet = useResource<{ items: Worklog[]; totalSeconds: number }>(
    `/timesheet${query({ from, to })}`,
  );

  const byDay = useMemo(() => {
    const groups = new Map<string, Worklog[]>();
    for (const log of sheet.data?.items ?? []) {
      const day = log.startedAt.slice(0, 10);
      groups.set(day, [...(groups.get(day) ?? []), log]);
    }
    return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [sheet.data]);

  return (
    <div>
      <PageHeader
        title="برگه زمان"
        subtitle={
          sheet.data ? `جمع: ${formatDuration(sheet.data.totalSeconds)}` : "زمان‌های ثبت‌شده تو"
        }
        actions={
          <div className="flex items-center gap-2 text-[12px]">
            <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="w-auto py-1" />
            <span className="text-muted">تا</span>
            <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="w-auto py-1" />
          </div>
        }
      />

      <div className="space-y-3 p-5">
        {sheet.loading &&
          [0, 1].map((index) => <Skeleton key={index} className="h-24" />)}

        {byDay.map(([day, logs]) => {
          const total = logs.reduce((sum, log) => sum + log.seconds, 0);
          return (
            <Card key={day}>
              <div className="mb-2 flex items-center justify-between border-b border-line pb-2">
                <h2 className="text-[13px] font-bold">{formatDate(`${day}T00:00:00Z`)}</h2>
                <span className="text-[12px] text-accent">{formatDuration(total)}</span>
              </div>
              <div className="space-y-1.5">
                {logs.map((log) => (
                  <div key={log.id} className="flex items-center gap-2 text-[13px]">
                    <Link href={`/issue/${log.issueKey}`} className="latin w-20 shrink-0 text-accent">
                      {log.issueKey}
                    </Link>
                    <span className="min-w-0 flex-1 truncate text-ink-2">
                      {log.note || "بدون توضیح"}
                    </span>
                    <span className="shrink-0 text-muted">{formatDuration(log.seconds)}</span>
                  </div>
                ))}
              </div>
            </Card>
          );
        })}

        {!sheet.loading && byDay.length === 0 && (
          <EmptyState
            title="زمانی در این بازه ثبت نشده"
            description="از صفحه هر ایشیو، دکمه «ثبت زمان»."
          />
        )}
      </div>
    </div>
  );
}
