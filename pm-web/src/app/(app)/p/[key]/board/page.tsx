"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiError, api, query } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatNumber } from "@/lib/format";
import { useProject } from "@/lib/project";
import type { Board, Issue } from "@/lib/types";
import { IssueCard } from "@/components/IssueCard";
import { IssueComposer } from "@/components/IssueComposer";
import { IssueFilters, emptyFilters, filtersToQuery, type FilterState } from "@/components/IssueFilters";
import { SprintControls } from "@/components/SprintControls";
import { Button, EmptyState, ErrorNote, Spinner } from "@/components/ui";

/**
 * The board.
 *
 * Drag and drop is written against the HTML5 drag events rather than a
 * library. A board is a handful of drop targets and one dragged element;
 * the libraries that do this well are for sortable trees and virtualised
 * grids, and pulling one in would be more code shipped to the browser
 * than the whole screen.
 *
 * Every move is optimistic. The card lands where it was dropped
 * immediately and the request follows; if it fails the board reloads and
 * the card snaps back, with the error stated rather than swallowed.
 */
export default function BoardPage() {
  const { project, sprints, reload: reloadProject } = useProject();
  const { canWrite } = useAuth();

  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [sprintChoice, setSprintChoice] = useState<string>("");
  const [dragging, setDragging] = useState<Issue | null>(null);
  const [dropTarget, setDropTarget] = useState<{ statusId: string; index: number } | null>(null);
  const [composerStatus, setComposerStatus] = useState<string | null>(null);

  const activeSprint = project?.activeSprint;

  const load = useCallback(async () => {
    if (!project) return;
    setError(null);
    try {
      const result = await api.get<Board>(
        `/projects/${project.key}/board${query({ sprint: sprintChoice, ...filtersToQuery(filters) })}`,
      );
      setBoard(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطا در بارگذاری برد");
    } finally {
      setLoading(false);
    }
  }, [project, sprintChoice, filters]);

  // Filters are debounced together with the fetch so typing in the
  // filter box does not fire a board query per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => void load(), 200);
    return () => clearTimeout(timer);
  }, [load]);

  const moveCard = async (statusId: string, index: number) => {
    if (!dragging || !board) return;

    const column = board.columns.find((entry) => entry.status.id === statusId);
    if (!column) return;

    // The neighbours are computed from the column with the dragged card
    // removed, so dropping a card one slot below its own position means
    // what the person saw rather than being off by one.
    const without = column.issues.filter((issue) => issue.id !== dragging.id);
    const afterId = index > 0 ? without[index - 1]?.id : undefined;
    const beforeId = without[index]?.id;

    const previous = board;
    setBoard({
      ...board,
      columns: board.columns.map((entry) => {
        if (entry.status.id === dragging.status.id && entry.status.id !== statusId) {
          return { ...entry, issues: entry.issues.filter((issue) => issue.id !== dragging.id) };
        }
        if (entry.status.id !== statusId) return entry;

        const next = [...without];
        next.splice(index, 0, { ...dragging, status: entry.status });
        return { ...entry, issues: next };
      }),
    });
    setDragging(null);
    setDropTarget(null);

    try {
      await api.post(`/issues/${dragging.id}/move`, {
        statusId,
        afterId: afterId ?? "",
        beforeId: beforeId ?? "",
      });
      // The counts and the sprint header depend on what just moved.
      void load();
    } catch (err) {
      setBoard(previous);
      setError(err instanceof ApiError ? err.message : "جابه‌جایی ذخیره نشد");
    }
  };

  const sprintOptions = useMemo(
    () => sprints.filter((sprint) => sprint.state !== "completed"),
    [sprints],
  );

  if (loading && !board) {
    return (
      <div className="flex h-64 items-center justify-center text-muted">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={sprintChoice}
            onChange={(event) => setSprintChoice(event.target.value)}
            className="rounded-[var(--radius-input)] border border-line-strong bg-surface px-2.5 py-1 text-[12px] focus:border-accent focus:outline-none"
          >
            <option value="">{activeSprint ? `اسپرینت فعال: ${activeSprint.name}` : "همه کارها"}</option>
            <option value="backlog">بک‌لاگ (بدون اسپرینت)</option>
            {sprintOptions.map((sprint) => (
              <option key={sprint.id} value={sprint.id}>
                {sprint.name}
              </option>
            ))}
          </select>

          {board?.sprint && (
            <SprintControls
              sprint={board.sprint}
              sprints={sprints}
              onChanged={() => {
                void reloadProject();
                void load();
              }}
            />
          )}
        </div>

        {canWrite && (
          <Button variant="primary" onClick={() => setComposerStatus("")}>
            + ایشیو تازه
          </Button>
        )}
      </div>

      <IssueFilters filters={filters} onChange={setFilters} />

      {error && (
        <div className="px-5 pb-2">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {board && board.columns.length === 0 ? (
        <div className="p-5">
          <EmptyState
            title="این پروژه ستونی ندارد"
            description="از تب تنظیمات ستون‌های برد را بساز."
          />
        </div>
      ) : (
        <div className="flex flex-1 gap-3 overflow-x-auto px-5 pb-5">
          {board?.columns.map((column) => {
            const overLimit =
              column.status.wipLimit != null && column.issues.length > column.status.wipLimit;

            return (
              <section
                key={column.status.id}
                onDragOver={(event) => {
                  if (!dragging) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  if (dropTarget?.statusId !== column.status.id) {
                    setDropTarget({ statusId: column.status.id, index: column.issues.length });
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  void moveCard(column.status.id, dropTarget?.index ?? column.issues.length);
                }}
                className={`flex w-72 shrink-0 flex-col rounded-[var(--radius-card)] border bg-surface/60 transition-colors ${
                  dropTarget?.statusId === column.status.id && dragging
                    ? "border-accent"
                    : "border-line"
                }`}
              >
                <header className="flex items-center gap-2 px-3 py-2">
                  <span
                    aria-hidden
                    className="size-2 rounded-full"
                    style={{ backgroundColor: column.status.color }}
                  />
                  <h2 className="text-[12px] font-bold tracking-wide text-ink-2">
                    {column.status.name}
                  </h2>
                  <span
                    className={`rounded px-1.5 text-[11px] ${
                      overLimit ? "bg-clay/20 font-bold text-clay" : "text-muted"
                    }`}
                    title={
                      column.status.wipLimit != null
                        ? `سقف WIP: ${formatNumber(column.status.wipLimit)}`
                        : undefined
                    }
                  >
                    {formatNumber(column.issues.length)}
                    {column.status.wipLimit != null && `/${formatNumber(column.status.wipLimit)}`}
                  </span>
                  {column.points > 0 && (
                    <span className="mr-auto text-[11px] text-muted">
                      {formatNumber(column.points)} امتیاز
                    </span>
                  )}
                </header>

                <div className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
                  {column.issues.map((issue, index) => (
                    <div
                      key={issue.id}
                      onDragOver={(event) => {
                        if (!dragging) return;
                        event.preventDefault();
                        event.stopPropagation();
                        // Above or below the midpoint decides whether the
                        // card lands before or after this one.
                        const rect = event.currentTarget.getBoundingClientRect();
                        const below = event.clientY > rect.top + rect.height / 2;
                        setDropTarget({
                          statusId: column.status.id,
                          index: below ? index + 1 : index,
                        });
                      }}
                    >
                      {dropTarget?.statusId === column.status.id &&
                        dropTarget.index === index &&
                        dragging && <div className="mb-2 h-0.5 rounded bg-accent" />}
                      <IssueCard
                        issue={issue}
                        draggable={canWrite}
                        dragging={dragging?.id === issue.id}
                        onDragStart={() => setDragging(issue)}
                        onDragEnd={() => {
                          setDragging(null);
                          setDropTarget(null);
                        }}
                      />
                    </div>
                  ))}

                  {dropTarget?.statusId === column.status.id &&
                    dropTarget.index >= column.issues.length &&
                    dragging && <div className="h-0.5 rounded bg-accent" />}

                  {column.issues.length === 0 && !dragging && (
                    <p className="px-2 py-6 text-center text-[12px] text-muted">خالی</p>
                  )}

                  {canWrite && (
                    <button
                      onClick={() => setComposerStatus(column.status.id)}
                      className="rounded-[var(--radius-input)] px-2 py-1.5 text-right text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-ink-2"
                    >
                      + افزودن
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <IssueComposer
        open={composerStatus !== null}
        onClose={() => setComposerStatus(null)}
        defaultStatusId={composerStatus || undefined}
        defaultSprintId={
          sprintChoice === "backlog" ? undefined : sprintChoice || board?.sprint?.id
        }
        onCreated={() => void load()}
      />
    </div>
  );
}
