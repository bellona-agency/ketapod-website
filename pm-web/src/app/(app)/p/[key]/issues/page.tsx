"use client";

import { useCallback, useEffect, useState } from "react";

import { api, query } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { useProject } from "@/lib/project";
import type { Issue, Paginated } from "@/lib/types";
import { IssueRow } from "@/components/IssueRow";
import { IssueFilters, emptyFilters, filtersToQuery, type FilterState } from "@/components/IssueFilters";
import { Button, EmptyState, Select, Spinner } from "@/components/ui";

/** The flat list: every issue in the project, filtered and sorted.
    Where you go when the board's slice is not the slice you want. */
export default function IssuesPage() {
  const { project, statuses } = useProject();

  const [page, setPage] = useState<Paginated<Issue> | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [sort, setSort] = useState("updated");
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);

  const limit = 50;

  const load = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    try {
      const result = await api.get<Paginated<Issue>>(
        `/projects/${project.key}/issues${query({
          ...filtersToQuery(filters),
          status,
          sort,
          limit,
          offset,
        })}`,
      );
      setPage(result);
    } finally {
      setLoading(false);
    }
  }, [project, filters, sort, status, offset]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 200);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-2.5">
        <span className="text-[12px] text-muted">
          {page ? `${formatNumber(page.total)} ایشیو` : "…"}
        </span>
        <div className="flex gap-2">
          <Select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setOffset(0);
            }}
            className="w-auto py-1 text-[12px]"
          >
            <option value="">همه ستون‌ها</option>
            {statuses.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </Select>
          <Select
            value={sort}
            onChange={(event) => {
              setSort(event.target.value);
              setOffset(0);
            }}
            className="w-auto py-1 text-[12px]"
          >
            <option value="updated">آخرین تغییر</option>
            <option value="created">تازه‌ترین</option>
            <option value="priority">اولویت</option>
            <option value="due">مهلت</option>
            <option value="points">امتیاز</option>
            <option value="key">کلید</option>
          </Select>
        </div>
      </div>

      <IssueFilters
        filters={filters}
        onChange={(next) => {
          setFilters(next);
          // Any change to what is being asked for goes back to the first
          // page; otherwise a narrower filter lands you on an empty page
          // three with no way to tell why it is empty.
          setOffset(0);
        }}
      />

      {loading && !page ? (
        <div className="flex h-48 items-center justify-center text-muted">
          <Spinner />
        </div>
      ) : page && page.items.length === 0 ? (
        <div className="p-5">
          <EmptyState title="چیزی با این فیلترها پیدا نشد" />
        </div>
      ) : (
        <div className="divide-y divide-[var(--color-line)] border-t border-line">
          {page?.items.map((issue) => (
            <IssueRow key={issue.id} issue={issue} />
          ))}
        </div>
      )}

      {page && page.total > limit && (
        <div className="flex items-center justify-center gap-3 p-4 text-[12px]">
          <Button disabled={offset === 0} onClick={() => setOffset((value) => Math.max(0, value - limit))}>
            قبلی
          </Button>
          <span className="text-muted">
            {formatNumber(Math.floor(offset / limit) + 1)} از{" "}
            {formatNumber(Math.ceil(page.total / limit))}
          </span>
          <Button
            disabled={offset + limit >= page.total}
            onClick={() => setOffset((value) => value + limit)}
          >
            بعدی
          </Button>
        </div>
      )}
    </div>
  );
}
