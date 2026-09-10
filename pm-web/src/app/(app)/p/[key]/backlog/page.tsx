"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, api, query } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatNumber } from "@/lib/format";
import { useProject } from "@/lib/project";
import type { Backlog, Issue, Sprint } from "@/lib/types";
import { IssueComposer } from "@/components/IssueComposer";
import { IssueFilters, emptyFilters, filtersToQuery, type FilterState } from "@/components/IssueFilters";
import { IssueRow } from "@/components/IssueRow";
import { SprintControls } from "@/components/SprintControls";
import { Button, EmptyState, ErrorNote, Field, Input, Modal, Spinner, Textarea } from "@/components/ui";

/**
 * The backlog: the planned sprints on top, the unplanned work below,
 * and dragging between them.
 *
 * Sprint contents are fetched per sprint rather than in one call. The
 * backlog itself can run to hundreds of rows and the sprints are small,
 * so one big response would be mostly backlog — and every drag would
 * have to re-fetch all of it.
 */
export default function BacklogPage() {
  const { project, sprints, reload: reloadProject } = useProject();
  const { canWrite } = useAuth();

  const [data, setData] = useState<Backlog | null>(null);
  const [sprintIssues, setSprintIssues] = useState<Record<string, Issue[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [dragging, setDragging] = useState<Issue | null>(null);
  const [dropZone, setDropZone] = useState<string | null>(null);
  const [composerSprint, setComposerSprint] = useState<string | null>(null);
  const [creatingSprint, setCreatingSprint] = useState(false);

  const load = useCallback(async () => {
    if (!project) return;
    setError(null);
    try {
      const backlog = await api.get<Backlog>(
        `/projects/${project.key}/backlog${query(filtersToQuery(filters))}`,
      );
      setData(backlog);

      const perSprint = await Promise.all(
        backlog.sprints.map(async (sprint) => {
          const page = await api.get<{ items: Issue[] }>(
            `/projects/${project.key}/issues${query({ sprintId: sprint.id, sort: "rank", limit: 100, ...filtersToQuery(filters) })}`,
          );
          return [sprint.id, page.items] as const;
        }),
      );
      setSprintIssues(Object.fromEntries(perSprint));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطا در بارگذاری بک‌لاگ");
    } finally {
      setLoading(false);
    }
  }, [project, filters]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 200);
    return () => clearTimeout(timer);
  }, [load]);

  const moveToSprint = async (sprintId: string | null) => {
    if (!dragging) return;
    const issue = dragging;
    setDragging(null);
    setDropZone(null);

    if ((issue.sprintId ?? null) === sprintId) return;

    try {
      await api.post(`/issues/${issue.id}/move`, {
        sprintId: sprintId ?? "",
        clearSprint: sprintId === null,
      });
      void load();
      void reloadProject();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "جابه‌جایی ذخیره نشد");
    }
  };

  if (loading && !data) {
    return (
      <div className="flex h-64 items-center justify-center text-muted">
        <Spinner />
      </div>
    );
  }

  const dropProps = (zone: string, sprintId: string | null) => ({
    onDragOver: (event: React.DragEvent) => {
      if (!dragging) return;
      event.preventDefault();
      setDropZone(zone);
    },
    onDragLeave: () => setDropZone((current) => (current === zone ? null : current)),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      void moveToSprint(sprintId);
    },
    className: `rounded-[var(--radius-card)] border transition-colors ${
      dropZone === zone && dragging ? "border-accent bg-accent-dim/10" : "border-line"
    }`,
  });

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-2.5">
        <span className="text-[12px] text-muted">
          {formatNumber(data?.total ?? 0)} کار در بک‌لاگ
        </span>
        {canWrite && (
          <div className="flex gap-2">
            <Button onClick={() => setCreatingSprint(true)}>+ اسپرینت</Button>
            <Button variant="primary" onClick={() => setComposerSprint("")}>
              + ایشیو تازه
            </Button>
          </div>
        )}
      </div>

      <IssueFilters filters={filters} onChange={setFilters} />

      {error && (
        <div className="px-5 pb-2">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <div className="space-y-4 px-5 pb-8">
        {data?.sprints.map((sprint) => (
          <section key={sprint.id} {...dropProps(sprint.id, sprint.id)}>
            <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
              <h2 className="text-[13px] font-bold">{sprint.name}</h2>
              {sprint.state === "active" && (
                <span className="rounded-full bg-accent-dim px-2 text-[11px] font-semibold text-accent">
                  فعال
                </span>
              )}
              {sprint.startsAt && (
                <span className="text-[11px] text-muted">
                  {formatDate(sprint.startsAt)} تا {formatDate(sprint.endsAt)}
                </span>
              )}
              <span className="mr-auto flex items-center gap-2">
                <SprintControls
                  sprint={sprint}
                  sprints={sprints}
                  onChanged={() => {
                    void reloadProject();
                    void load();
                  }}
                />
              </span>
            </header>

            <div className="divide-y divide-[var(--color-line)]">
              {(sprintIssues[sprint.id] ?? []).map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  draggable={canWrite}
                  dragging={dragging?.id === issue.id}
                  onDragStart={() => setDragging(issue)}
                  onDragEnd={() => setDragging(null)}
                />
              ))}
              {(sprintIssues[sprint.id] ?? []).length === 0 && (
                <p className="px-3 py-6 text-center text-[12px] text-muted">
                  کاری در این اسپرینت نیست — از پایین بکش و اینجا بینداز
                </p>
              )}
            </div>

            {canWrite && (
              <button
                onClick={() => setComposerSprint(sprint.id)}
                className="w-full px-3 py-2 text-right text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-ink-2"
              >
                + افزودن به این اسپرینت
              </button>
            )}
          </section>
        ))}

        <section {...dropProps("backlog", null)}>
          <header className="flex items-center gap-2 border-b border-line px-3 py-2">
            <h2 className="text-[13px] font-bold">بک‌لاگ</h2>
            <span className="text-[11px] text-muted">{formatNumber(data?.issues.length ?? 0)}</span>
          </header>

          <div className="divide-y divide-[var(--color-line)]">
            {data?.issues.map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                draggable={canWrite}
                dragging={dragging?.id === issue.id}
                onDragStart={() => setDragging(issue)}
                onDragEnd={() => setDragging(null)}
              />
            ))}
          </div>

          {data?.issues.length === 0 && (
            <div className="p-4">
              <EmptyState title="بک‌لاگ خالی است" description="هر چه هنوز در اسپرینتی نیست اینجا می‌آید." />
            </div>
          )}
        </section>
      </div>

      <IssueComposer
        open={composerSprint !== null}
        onClose={() => setComposerSprint(null)}
        defaultSprintId={composerSprint || undefined}
        onCreated={() => void load()}
      />

      <NewSprintModal
        open={creatingSprint}
        onClose={() => setCreatingSprint(false)}
        onCreated={() => {
          void reloadProject();
          void load();
        }}
      />
    </div>
  );
}

function NewSprintModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (sprint: Sprint) => void;
}) {
  const { project } = useProject();
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!project) return;
    setBusy(true);
    setError(null);
    try {
      const sprint = await api.post<Sprint>(`/projects/${project.key}/sprints`, {
        name,
        goal,
        startsAt: startsAt || null,
        endsAt: endsAt || null,
      });
      onCreated(sprint);
      setName("");
      setGoal("");
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? (err.firstFieldError ?? err.message) : "خطا در ساخت اسپرینت");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="اسپرینت تازه">
      <form onSubmit={submit} className="space-y-3">
        <Field label="نام">
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            placeholder="اسپرینت ۳"
          />
        </Field>
        <Field label="هدف" hint="یک جمله که در پایان اسپرینت بشود با آن قضاوت کرد">
          <Textarea rows={2} value={goal} onChange={(event) => setGoal(event.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="شروع">
            <Input type="date" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
          </Field>
          <Field label="پایان">
            <Input type="date" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
          </Field>
        </div>

        <ErrorNote>{error}</ErrorNote>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onClose}>
            انصراف
          </Button>
          <Button variant="primary" type="submit" loading={busy}>
            ساختن
          </Button>
        </div>
      </form>
    </Modal>
  );
}
