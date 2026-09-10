"use client";

import { typeLabels, priorityLabels } from "@/lib/format";
import { useAssignables, useProject } from "@/lib/project";

import { Avatar } from "./ui";

export interface FilterState {
  q: string;
  assignee: string[];
  type: string[];
  priority: string[];
  label: string[];
  unassigned: boolean;
}

export const emptyFilters: FilterState = {
  q: "",
  assignee: [],
  type: [],
  priority: [],
  label: [],
  unassigned: false,
};

export function filtersToQuery(filters: FilterState): Record<string, string | boolean> {
  return {
    q: filters.q.trim(),
    assignee: filters.assignee.join(","),
    type: filters.type.join(","),
    priority: filters.priority.join(","),
    label: filters.label.join(","),
    unassigned: filters.unassigned,
  };
}

export function hasActiveFilters(filters: FilterState): boolean {
  return (
    filters.q.trim() !== "" ||
    filters.assignee.length > 0 ||
    filters.type.length > 0 ||
    filters.priority.length > 0 ||
    filters.label.length > 0 ||
    filters.unassigned
  );
}

/**
 * The filter bar above the board and the backlog.
 *
 * Avatars are toggles rather than a dropdown because "show me only
 * Iman's cards" is the filter people use twenty times a day, and a
 * dropdown makes it three clicks instead of one.
 */
export function IssueFilters({
  filters,
  onChange,
}: {
  filters: FilterState;
  onChange: (next: FilterState) => void;
}) {
  const { labels } = useProject();
  const assignables = useAssignables();

  const toggle = (key: "assignee" | "type" | "priority" | "label", value: string) => {
    const current = filters[key];
    onChange({
      ...filters,
      [key]: current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 px-5 py-2.5">
      <input
        value={filters.q}
        onChange={(event) => onChange({ ...filters, q: event.target.value })}
        placeholder="فیلتر…"
        className="w-40 rounded-[var(--radius-input)] border border-line-strong bg-surface px-2.5 py-1 text-[12px] placeholder:text-muted focus:border-accent focus:outline-none"
      />

      <div className="flex items-center -space-x-1.5 space-x-reverse">
        {assignables.map((person) => {
          const on = filters.assignee.includes(person.id);
          return (
            <button
              key={person.id}
              onClick={() => toggle("assignee", person.id)}
              title={person.fullName}
              className={`rounded-full transition-all ${
                on ? "ring-2 ring-accent" : "opacity-60 hover:opacity-100"
              }`}
            >
              <Avatar member={person} size={24} />
            </button>
          );
        })}
        <button
          onClick={() => onChange({ ...filters, unassigned: !filters.unassigned })}
          title="بدون مسئول"
          className={`rounded-full transition-all ${
            filters.unassigned ? "ring-2 ring-accent" : "opacity-60 hover:opacity-100"
          }`}
        >
          <Avatar size={24} />
        </button>
      </div>

      <Dropdown label="نوع" options={typeLabels} selected={filters.type} onToggle={(value) => toggle("type", value)} />
      <Dropdown
        label="اولویت"
        options={priorityLabels}
        selected={filters.priority}
        onToggle={(value) => toggle("priority", value)}
      />
      {labels.length > 0 && (
        <Dropdown
          label="برچسب"
          options={Object.fromEntries(labels.map((label) => [label.id, label.name]))}
          selected={filters.label}
          onToggle={(value) => toggle("label", value)}
        />
      )}

      {hasActiveFilters(filters) && (
        <button
          onClick={() => onChange(emptyFilters)}
          className="text-[12px] text-accent transition-opacity hover:opacity-80"
        >
          پاک کردن فیلترها
        </button>
      )}
    </div>
  );
}

function Dropdown({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: Record<string, string>;
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <details className="relative">
      <summary
        className={`cursor-pointer list-none rounded-[var(--radius-input)] border px-2.5 py-1 text-[12px] transition-colors ${
          selected.length > 0
            ? "border-accent text-accent"
            : "border-line-strong text-ink-2 hover:bg-surface-2"
        }`}
      >
        {label}
        {selected.length > 0 ? ` (${selected.length})` : ""}
      </summary>
      <div className="absolute right-0 top-full z-20 mt-1 min-w-36 rounded-[var(--radius-input)] border border-line-strong bg-surface p-1 shadow-xl">
        {Object.entries(options).map(([value, text]) => (
          <label
            key={value}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[12px] hover:bg-surface-2"
          >
            <input
              type="checkbox"
              checked={selected.includes(value)}
              onChange={() => onToggle(value)}
              className="accent-[var(--color-accent)]"
            />
            {text}
          </label>
        ))}
      </div>
    </details>
  );
}
