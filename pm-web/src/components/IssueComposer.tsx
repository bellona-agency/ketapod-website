"use client";

import { useState } from "react";

import { ApiError, api } from "@/lib/api";
import { typeLabels, priorityLabels } from "@/lib/format";
import { useAssignables, useProject } from "@/lib/project";
import type { Issue } from "@/lib/types";

import { Button, ErrorNote, Field, Input, Modal, Select, Textarea } from "./ui";

/**
 * Creating an issue.
 *
 * Only the title is required, and everything else has a sensible
 * default. A required-field wall is how a tracker ends up with work
 * that lives in chat instead — the point is that filing something takes
 * five seconds, and the details get filled in on the issue page later.
 */
export function IssueComposer({
  open,
  onClose,
  onCreated,
  defaultStatusId,
  defaultSprintId,
  defaultParentId,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (issue: Issue) => void;
  defaultStatusId?: string;
  defaultSprintId?: string;
  defaultParentId?: string;
}) {
  const { project, statuses, labels, sprints } = useProject();
  const assignables = useAssignables();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState(defaultParentId ? "subtask" : "task");
  const [priority, setPriority] = useState("medium");
  const [statusId, setStatusId] = useState(defaultStatusId ?? "");
  const [assigneeId, setAssigneeId] = useState("");
  const [sprintId, setSprintId] = useState(defaultSprintId ?? "");
  const [points, setPoints] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [again, setAgain] = useState(false);

  const reset = () => {
    setTitle("");
    setDescription("");
    setPoints("");
    setDueAt("");
    setLabelIds([]);
    setError(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!project) return;

    setBusy(true);
    setError(null);
    try {
      const issue = await api.post<Issue>(`/projects/${project.key}/issues`, {
        title,
        description,
        type,
        priority,
        statusId: statusId || undefined,
        assigneeId: assigneeId || undefined,
        sprintId: sprintId || undefined,
        parentId: defaultParentId || undefined,
        storyPoints: points ? Number(points) : undefined,
        dueAt: dueAt || undefined,
        labelIds,
      });

      onCreated(issue);
      // "Create another" keeps the dialog open with the shape of the
      // last issue, which is what filing a backlog actually looks like.
      if (again) reset();
      else {
        reset();
        onClose();
      }
    } catch (err) {
      setError(err instanceof ApiError ? (err.firstFieldError ?? err.message) : "خطا در ساخت ایشیو");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={defaultParentId ? "زیرتسک تازه" : "ایشیو تازه"} wide>
      <form onSubmit={submit} className="space-y-3">
        <Field label="عنوان">
          <Input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            placeholder="چه کاری باید انجام شود؟"
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="نوع">
            <Select value={type} onChange={(event) => setType(event.target.value)}>
              {Object.entries(typeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="اولویت">
            <Select value={priority} onChange={(event) => setPriority(event.target.value)}>
              {Object.entries(priorityLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="ستون">
            <Select value={statusId} onChange={(event) => setStatusId(event.target.value)}>
              <option value="">اولین ستون</option>
              {statuses.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="مسئول">
            <Select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
              <option value="">بدون مسئول</option>
              {assignables.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="اسپرینت">
            <Select value={sprintId} onChange={(event) => setSprintId(event.target.value)}>
              <option value="">بک‌لاگ</option>
              {sprints.map((sprint) => (
                <option key={sprint.id} value={sprint.id}>
                  {sprint.name}
                  {sprint.state === "active" ? " (فعال)" : ""}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="امتیاز">
            <Input
              type="number"
              min="0"
              step="0.5"
              value={points}
              onChange={(event) => setPoints(event.target.value)}
              placeholder="—"
            />
          </Field>
        </div>

        <Field label="مهلت">
          <Input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
        </Field>

        {labels.length > 0 && (
          <Field label="برچسب‌ها">
            <div className="flex flex-wrap gap-1.5">
              {labels.map((label) => {
                const on = labelIds.includes(label.id);
                return (
                  <button
                    key={label.id}
                    type="button"
                    onClick={() =>
                      setLabelIds((current) =>
                        on ? current.filter((id) => id !== label.id) : [...current, label.id],
                      )
                    }
                    style={{ color: label.color, borderColor: on ? label.color : undefined }}
                    className={`rounded border px-2 py-0.5 text-[12px] transition-colors ${
                      on ? "bg-surface-2" : "border-line-strong opacity-70"
                    }`}
                  >
                    {label.name}
                  </button>
                );
              })}
            </div>
          </Field>
        )}

        <Field label="توضیح">
          <Textarea
            rows={4}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="زمینه، قدم‌های بازتولید، یا هر چیزی که فردا لازم می‌شود"
          />
        </Field>

        <ErrorNote>{error}</ErrorNote>

        <div className="flex items-center justify-between gap-3 pt-1">
          <label className="flex items-center gap-2 text-[12px] text-muted">
            <input
              type="checkbox"
              checked={again}
              onChange={(event) => setAgain(event.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            یکی دیگر بساز
          </label>

          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              انصراف
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              ساختن
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
