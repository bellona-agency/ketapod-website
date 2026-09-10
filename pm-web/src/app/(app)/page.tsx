"use client";

import Link from "next/link";

import { query } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatNumber } from "@/lib/format";
import { useResource } from "@/lib/hooks";
import type { Issue, Paginated, Project } from "@/lib/types";
import { IssueRow } from "@/components/IssueRow";
import { PageHeader } from "@/components/PageHeader";
import { Card, EmptyState, Skeleton } from "@/components/ui";

/**
 * The landing screen: what is on me, right now.
 *
 * Not a metrics dashboard. The first question anyone opening a tracker
 * has is "what am I supposed to be doing", and a wall of charts is a
 * worse answer than a list of six issues.
 */
export default function DashboardPage() {
  const { member } = useAuth();

  const mine = useResource<Paginated<Issue>>(
    `/issues${query({ assignee: "me", category: "todo,in_progress", sort: "priority", limit: 25 })}`,
  );
  const reported = useResource<Paginated<Issue>>(
    `/issues${query({ reporter: "me", category: "todo,in_progress", sort: "updated", limit: 10 })}`,
  );
  const projects = useResource<{ items: Project[] }>("/projects");

  const overdue = mine.data?.items.filter(
    (issue) => issue.dueAt && new Date(issue.dueAt) < new Date(),
  );

  return (
    <div>
      <PageHeader
        title={`سلام ${member?.fullName.split(" ")[0] ?? ""}`}
        subtitle="کارهایی که روی توست"
      />

      <div className="grid gap-5 p-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          {overdue && overdue.length > 0 && (
            <Card className="border-clay/40">
              <h2 className="mb-2 text-[13px] font-bold text-clay">
                از مهلت گذشته ({formatNumber(overdue.length)})
              </h2>
              <div className="divide-y divide-[var(--color-line)]">
                {overdue.map((issue) => (
                  <IssueRow key={issue.id} issue={issue} />
                ))}
              </div>
            </Card>
          )}

          <section>
            <h2 className="mb-2 px-1 text-[13px] font-bold">
              واگذارشده به من{" "}
              {mine.data && (
                <span className="font-normal text-muted">({formatNumber(mine.data.total)})</span>
              )}
            </h2>

            {mine.loading ? (
              <div className="space-y-1">
                {[0, 1, 2].map((index) => (
                  <Skeleton key={index} className="h-10" />
                ))}
              </div>
            ) : mine.data && mine.data.items.length > 0 ? (
              <div className="divide-y divide-[var(--color-line)] rounded-[var(--radius-card)] border border-line">
                {mine.data.items.map((issue) => (
                  <IssueRow key={issue.id} issue={issue} />
                ))}
              </div>
            ) : (
              <EmptyState title="هیچ کار بازی روی تو نیست" description="یا واقعاً تمام شده، یا هنوز کسی چیزی به تو نداده." />
            )}
          </section>

          {reported.data && reported.data.items.length > 0 && (
            <section>
              <h2 className="mb-2 px-1 text-[13px] font-bold">کارهایی که من ثبت کرده‌ام</h2>
              <div className="divide-y divide-[var(--color-line)] rounded-[var(--radius-card)] border border-line">
                {reported.data.items.map((issue) => (
                  <IssueRow key={issue.id} issue={issue} />
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="space-y-3">
          <h2 className="px-1 text-[13px] font-bold">پروژه‌ها</h2>
          {projects.data?.items.map((project) => (
            <Link
              key={project.id}
              href={`/p/${project.key}/board`}
              className="block rounded-[var(--radius-card)] border border-line bg-surface p-3 transition-colors hover:border-line-strong"
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{ backgroundColor: project.color }}
                />
                <span className="flex-1 truncate text-[13px] font-semibold">{project.name}</span>
                <span className="latin text-[11px] text-muted">{project.key}</span>
              </div>
              <p className="mt-1 text-[11px] text-muted">
                {formatNumber(project.openCount)} کار باز از {formatNumber(project.issueCount)}
              </p>
              {project.activeSprint && (
                <p className="mt-1 text-[11px] text-accent">
                  {project.activeSprint.name} · {formatNumber(project.activeSprint.doneCount)} از{" "}
                  {formatNumber(project.activeSprint.issueCount)}
                </p>
              )}
            </Link>
          ))}
          {projects.data?.items.length === 0 && (
            <p className="px-1 text-[12px] text-muted">هنوز عضو پروژه‌ای نیستی.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
