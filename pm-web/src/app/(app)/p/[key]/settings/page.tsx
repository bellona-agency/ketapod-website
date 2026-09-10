"use client";

import { useState } from "react";

import { ApiError, announceProjectsChanged, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { categoryLabels, roleLabels } from "@/lib/format";
import { useProject } from "@/lib/project";
import type { Label, Status } from "@/lib/types";
import { Avatar, Button, Card, ErrorNote, Field, Input, Modal, Select, Textarea } from "@/components/ui";

/** Project settings: the board's columns, the label vocabulary, who is
    on the project, and archiving. */
export default function SettingsPage() {
  const { project, statuses, labels, members, team, reload } = useProject();
  const { canWrite, canAdmin } = useAuth();

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Status | null>(null);
  const [moveTo, setMoveTo] = useState("");

  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [color, setColor] = useState(project?.color ?? "#2FB8AE");

  const [newStatus, setNewStatus] = useState({ name: "", category: "todo" });
  const [newLabel, setNewLabel] = useState("");
  const [newMember, setNewMember] = useState("");

  if (!project) return null;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
      announceProjectsChanged();
    } catch (err) {
      setError(err instanceof ApiError ? (err.firstFieldError ?? err.message) : "ذخیره نشد");
    } finally {
      setBusy(false);
    }
  };

  const base = `/projects/${project.key}`;

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-5">
      {error && <ErrorNote>{error}</ErrorNote>}

      <Card>
        <h2 className="mb-3 text-[14px] font-bold">پروژه</h2>
        <div className="space-y-3">
          <Field label="نام">
            <Input value={name} disabled={!canWrite} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="توضیح">
            <Textarea
              rows={2}
              value={description}
              disabled={!canWrite}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          <Field label="رنگ" hint="فقط برای تشخیص سریع در نوار کناری">
            <input
              type="color"
              value={color}
              disabled={!canWrite}
              onChange={(event) => setColor(event.target.value)}
              className="h-8 w-16 cursor-pointer rounded border border-line-strong bg-surface"
            />
          </Field>

          {canWrite && (
            <Button
              variant="primary"
              loading={busy}
              onClick={() =>
                void run(() =>
                  api.patch(base, {
                    name,
                    description,
                    color,
                    leadId: project.lead?.id ?? "",
                  }),
                )
              }
            >
              ذخیره
            </Button>
          )}
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 text-[14px] font-bold">ستون‌های برد</h2>
        <p className="mb-3 text-[12px] text-muted">
          دسته هر ستون است که گزارش‌ها را می‌سازد، نه نامش. اگر ستون «تحویل شد» را
          روی دسته «انجام‌شده» نگذاری، برن‌داون هیچ‌وقت پایین نمی‌آید.
        </p>

        <div className="space-y-2">
          {statuses.map((status) => (
            <div key={status.id} className="flex flex-wrap items-center gap-2">
              <input
                type="color"
                value={status.color}
                disabled={!canWrite}
                onChange={(event) =>
                  void run(() =>
                    api.patch(`/statuses/${status.id}`, { ...status, color: event.target.value }),
                  )
                }
                className="h-7 w-9 cursor-pointer rounded border border-line-strong bg-surface"
              />
              <Input
                defaultValue={status.name}
                disabled={!canWrite}
                onBlur={(event) =>
                  event.target.value !== status.name &&
                  void run(() =>
                    api.patch(`/statuses/${status.id}`, { ...status, name: event.target.value }),
                  )
                }
                className="w-40"
              />
              <Select
                value={status.category}
                disabled={!canWrite}
                onChange={(event) =>
                  void run(() =>
                    api.patch(`/statuses/${status.id}`, { ...status, category: event.target.value }),
                  )
                }
                className="w-36"
              >
                {Object.entries(categoryLabels).map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </Select>
              <Input
                type="number"
                min="1"
                placeholder="سقف WIP"
                defaultValue={status.wipLimit ?? ""}
                disabled={!canWrite}
                onBlur={(event) =>
                  void run(() =>
                    api.patch(`/statuses/${status.id}`, {
                      ...status,
                      wipLimit: event.target.value ? Number(event.target.value) : null,
                    }),
                  )
                }
                className="w-24"
              />
              {canWrite && (
                <button
                  onClick={() => {
                    setDeleting(status);
                    setMoveTo(statuses.find((entry) => entry.id !== status.id)?.id ?? "");
                  }}
                  className="text-[12px] text-muted transition-colors hover:text-clay"
                >
                  حذف
                </button>
              )}
            </div>
          ))}
        </div>

        {canWrite && (
          <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
            <Input
              placeholder="نام ستون تازه"
              value={newStatus.name}
              onChange={(event) => setNewStatus({ ...newStatus, name: event.target.value })}
              className="w-40"
            />
            <Select
              value={newStatus.category}
              onChange={(event) => setNewStatus({ ...newStatus, category: event.target.value })}
              className="w-36"
            >
              {Object.entries(categoryLabels).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </Select>
            <Button
              loading={busy}
              disabled={!newStatus.name.trim()}
              onClick={() =>
                void run(async () => {
                  await api.post<Status>(`${base}/statuses`, newStatus);
                  setNewStatus({ name: "", category: "todo" });
                })
              }
            >
              افزودن ستون
            </Button>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-[14px] font-bold">برچسب‌ها</h2>
        <div className="flex flex-wrap gap-2">
          {labels.map((label) => (
            <span
              key={label.id}
              style={{ color: label.color, borderColor: `${label.color}55` }}
              className="flex items-center gap-1.5 rounded border px-2 py-0.5 text-[12px]"
            >
              {label.name}
              {canWrite && (
                <button
                  onClick={() => void run(() => api.del(`${base}/labels/${label.id}`))}
                  className="opacity-60 transition-opacity hover:opacity-100"
                  aria-label={`حذف ${label.name}`}
                >
                  ✕
                </button>
              )}
            </span>
          ))}
          {labels.length === 0 && <p className="text-[12px] text-muted">برچسبی تعریف نشده</p>}
        </div>

        {canWrite && (
          <div className="mt-3 flex gap-2 border-t border-line pt-3">
            <Input
              placeholder="برچسب تازه"
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
              className="w-48"
            />
            <Button
              disabled={!newLabel.trim()}
              loading={busy}
              onClick={() =>
                void run(async () => {
                  await api.post<Label>(`${base}/labels`, { name: newLabel });
                  setNewLabel("");
                })
              }
            >
              افزودن
            </Button>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-[14px] font-bold">اعضای پروژه</h2>
        <div className="space-y-2">
          {members.map((entry) => (
            <div key={entry.member.id} className="flex items-center gap-2">
              <Avatar member={entry.member} size={24} />
              <span className="flex-1 text-[13px]">{entry.member.fullName}</span>
              <Select
                value={entry.role}
                disabled={!canWrite}
                onChange={(event) =>
                  void run(() =>
                    api.post(`${base}/members`, {
                      memberId: entry.member.id,
                      role: event.target.value,
                    }),
                  )
                }
                className="w-28 py-1 text-[12px]"
              >
                <option value="lead">راهبر</option>
                <option value="member">عضو</option>
                <option value="viewer">بیننده</option>
              </Select>
              {canWrite && (
                <button
                  onClick={() => void run(() => api.del(`${base}/members/${entry.member.id}`))}
                  className="text-[12px] text-muted transition-colors hover:text-clay"
                >
                  حذف
                </button>
              )}
            </div>
          ))}
          {members.length === 0 && (
            <p className="text-[12px] text-muted">
              کسی اضافه نشده — تا وقتی خالی است، همه اعضای فعال تیم قابل واگذاری‌اند.
            </p>
          )}
        </div>

        {canWrite && (
          <div className="mt-3 flex gap-2 border-t border-line pt-3">
            <Select value={newMember} onChange={(event) => setNewMember(event.target.value)} className="w-56">
              <option value="">یک نفر را انتخاب کن…</option>
              {team
                .filter(
                  (person) =>
                    person.status === "active" &&
                    !members.some((entry) => entry.member.id === person.id),
                )
                .map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.fullName} ({roleLabels[person.role]})
                  </option>
                ))}
            </Select>
            <Button
              disabled={!newMember}
              loading={busy}
              onClick={() =>
                void run(async () => {
                  await api.post(`${base}/members`, { memberId: newMember, role: "member" });
                  setNewMember("");
                })
              }
            >
              افزودن
            </Button>
          </div>
        )}
      </Card>

      {canAdmin && (
        <Card>
          <h2 className="mb-1 text-[14px] font-bold">بایگانی</h2>
          <p className="mb-3 text-[12px] text-muted">
            پروژه حذف نمی‌شود؛ ایشیوهایش سابقه کار تیم‌اند. بایگانی فقط از فهرست‌ها پنهانش می‌کند.
          </p>
          <Button
            variant={project.archivedAt ? "outline" : "danger"}
            loading={busy}
            onClick={() =>
              void run(() => api.post(`${base}/archive`, { archived: !project.archivedAt }))
            }
          >
            {project.archivedAt ? "برگرداندن از بایگانی" : "بایگانی کردن پروژه"}
          </Button>
        </Card>
      )}

      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`حذف ستون «${deleting?.name ?? ""}»`}
      >
        <div className="space-y-3">
          <p className="text-[13px] text-ink-2">
            ایشیوهای این ستون باید جایی بروند. کدام ستون؟
          </p>
          <Select value={moveTo} onChange={(event) => setMoveTo(event.target.value)}>
            {statuses
              .filter((status) => status.id !== deleting?.id)
              .map((status) => (
                <option key={status.id} value={status.id}>
                  {status.name}
                </option>
              ))}
          </Select>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              انصراف
            </Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={() =>
                void run(async () => {
                  await api.del(`/statuses/${deleting?.id}?moveTo=${moveTo}`);
                  setDeleting(null);
                })
              }
            >
              حذف ستون
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
