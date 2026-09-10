"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatNumber,
  linkLabels,
  parseDuration,
  priorityLabels,
  timeAgo,
  toDateInput,
  typeColors,
  typeGlyphs,
  typeLabels,
} from "@/lib/format";
import { ProjectProvider, useAssignables, useProject } from "@/lib/project";
import type { IssueDetail } from "@/lib/types";
import { ActivityFeed } from "@/components/ActivityFeed";
import { IssueComposer } from "@/components/IssueComposer";
import { IssueRow } from "@/components/IssueRow";
import { MentionBox, RichText } from "@/components/MentionBox";
import {
  Avatar,
  Button,
  ErrorNote,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";

/**
 * The issue page.
 *
 * Two columns: the conversation on the right (where a person reads), the
 * fields on the left (where they change things). Every field saves on
 * change rather than behind a Save button — a form with a Save button is
 * a form people leave half-filled, and every edit here is one PATCH that
 * the server records in the history anyway.
 */
export default function IssuePage() {
  const { key } = useParams<{ key: string }>();
  const projectKey = decodeURIComponent(key).split("-")[0];
  return (
    <ProjectProvider projectKey={projectKey}>
      <IssueBody issueKey={decodeURIComponent(key).toUpperCase()} />
    </ProjectProvider>
  );
}

function IssueBody({ issueKey }: { issueKey: string }) {
  const { statuses, labels, sprints, loading: projectLoading } = useProject();
  const assignables = useAssignables();
  const { member, canWrite, canAdmin } = useAuth();
  const router = useRouter();

  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [editingDescription, setEditingDescription] = useState(false);
  const [comment, setComment] = useState("");
  const [logging, setLogging] = useState(false);
  const [linking, setLinking] = useState(false);
  const [subtaskOpen, setSubtaskOpen] = useState(false);

  // Every write on this page ends with a reload, and the reload is a
  // counter bump rather than a fetch the caller runs: it keeps the fetch
  // in one place, and keeps setState off the synchronous path of the
  // effect that runs on mount.
  const [version, setVersion] = useState(0);
  const load = useCallback(async () => {
    setVersion((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const detail = await api.get<IssueDetail>(`/issues/${issueKey}`);
        if (cancelled) return;
        setIssue(detail);
        setTitle(detail.title);
        setDescription(detail.description ?? "");
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "ایشیو پیدا نشد");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [issueKey, version]);

  const patch = async (body: Record<string, unknown>) => {
    if (!issue) return;
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/issues/${issue.id}`, body);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? (err.firstFieldError ?? err.message) : "ذخیره نشد");
    } finally {
      setSaving(false);
    }
  };

  const postComment = async () => {
    if (!issue || !comment.trim()) return;
    setSaving(true);
    try {
      await api.post(`/issues/${issue.id}/comments`, { body: comment });
      setComment("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "کامنت ثبت نشد");
    } finally {
      setSaving(false);
    }
  };

  const uploadAttachment = async (file: File) => {
    if (!issue) return;
    const form = new FormData();
    form.set("file", file);
    setSaving(true);
    try {
      await api.upload(`/issues/${issue.id}/attachments`, form);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? (err.firstFieldError ?? err.message) : "آپلود نشد");
    } finally {
      setSaving(false);
    }
  };

  if (loading || projectLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted">
        <Spinner />
      </div>
    );
  }
  if (!issue) {
    return <p className="p-8 text-center text-[13px] text-clay">{error ?? "ایشیو پیدا نشد"}</p>;
  }

  const watching = issue.watchers.some((watcher) => watcher.id === member?.id);

  return (
    <div className="mx-auto max-w-6xl px-5 py-4">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-muted">
        <Link href={`/p/${issue.projectKey}/board`} className="transition-colors hover:text-ink-2">
          {issue.projectKey}
        </Link>
        <span aria-hidden>/</span>
        {issue.parentKey && (
          <>
            <Link href={`/issue/${issue.parentKey}`} className="latin transition-colors hover:text-ink-2">
              {issue.parentKey}
            </Link>
            <span aria-hidden>/</span>
          </>
        )}
        <span aria-hidden style={{ color: typeColors[issue.type] }}>
          {typeGlyphs[issue.type]}
        </span>
        <span className="latin">{issue.key}</span>
        {saving && <Spinner />}
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0 space-y-5">
          <input
            value={title}
            disabled={!canWrite}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => title !== issue.title && void patch({ title })}
            className="w-full rounded-[var(--radius-input)] border border-transparent bg-transparent px-1 py-0.5 text-[20px] font-bold text-ink transition-colors hover:border-line focus:border-accent focus:outline-none disabled:hover:border-transparent"
          />

          <section>
            <h2 className="mb-1.5 text-[12px] font-bold tracking-wide text-muted">توضیح</h2>
            {editingDescription ? (
              <div className="space-y-2">
                <Textarea
                  rows={8}
                  autoFocus
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    onClick={async () => {
                      await patch({ description });
                      setEditingDescription(false);
                    }}
                  >
                    ذخیره
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setDescription(issue.description ?? "");
                      setEditingDescription(false);
                    }}
                  >
                    انصراف
                  </Button>
                </div>
              </div>
            ) : (
              <button
                disabled={!canWrite}
                onClick={() => setEditingDescription(true)}
                className="w-full rounded-[var(--radius-input)] border border-transparent px-2 py-1.5 text-right transition-colors hover:border-line disabled:cursor-default"
              >
                {issue.description ? (
                  <RichText body={issue.description} />
                ) : (
                  <span className="text-[13px] text-muted">توضیحی نوشته نشده — برای افزودن کلیک کن</span>
                )}
              </button>
            )}
          </section>

          {(issue.subtasks.length > 0 || canWrite) && (
            <section>
              <div className="mb-1.5 flex items-center justify-between">
                <h2 className="text-[12px] font-bold tracking-wide text-muted">
                  زیرتسک‌ها ({formatNumber(issue.subtasks.length)})
                </h2>
                {canWrite && (
                  <button
                    onClick={() => setSubtaskOpen(true)}
                    className="text-[12px] text-accent transition-opacity hover:opacity-80"
                  >
                    + افزودن
                  </button>
                )}
              </div>
              <div className="divide-y divide-[var(--color-line)] rounded-[var(--radius-card)] border border-line">
                {issue.subtasks.map((subtask) => (
                  <IssueRow key={subtask.id} issue={subtask} />
                ))}
                {issue.subtasks.length === 0 && (
                  <p className="px-3 py-4 text-center text-[12px] text-muted">زیرتسکی نیست</p>
                )}
              </div>
            </section>
          )}

          {(issue.links.length > 0 || canWrite) && (
            <section>
              <div className="mb-1.5 flex items-center justify-between">
                <h2 className="text-[12px] font-bold tracking-wide text-muted">پیوندها</h2>
                {canWrite && (
                  <button
                    onClick={() => setLinking(true)}
                    className="text-[12px] text-accent transition-opacity hover:opacity-80"
                  >
                    + پیوند
                  </button>
                )}
              </div>
              <div className="space-y-1">
                {issue.links.map((link) => (
                  <div key={link.id} className="flex items-center gap-2 text-[13px]">
                    <span className="w-28 shrink-0 text-[11px] text-muted">
                      {link.outward ? linkLabels[link.kind].outward : linkLabels[link.kind].inward}
                    </span>
                    <Link href={`/issue/${link.issueKey}`} className="latin text-accent">
                      {link.issueKey}
                    </Link>
                    <span
                      className={`min-w-0 flex-1 truncate ${
                        link.category === "done" ? "text-muted line-through" : ""
                      }`}
                    >
                      {link.title}
                    </span>
                    {canWrite && (
                      <button
                        onClick={async () => {
                          await api.del(`/links/${link.id}`);
                          void load();
                        }}
                        className="text-muted transition-colors hover:text-clay"
                        aria-label="حذف پیوند"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                {issue.links.length === 0 && (
                  <p className="text-[12px] text-muted">پیوندی نیست</p>
                )}
              </div>
            </section>
          )}

          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <h2 className="text-[12px] font-bold tracking-wide text-muted">
                پیوست‌ها ({formatNumber(issue.attachments.length)})
              </h2>
              {canWrite && (
                <label className="cursor-pointer text-[12px] text-accent transition-opacity hover:opacity-80">
                  + آپلود
                  <input
                    type="file"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void uploadAttachment(file);
                      event.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {issue.attachments.map((attachment) => (
                <a
                  key={attachment.id}
                  href={api.url(`/attachments/${attachment.id}`)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-[var(--radius-input)] border border-line px-2.5 py-1.5 text-[12px] transition-colors hover:border-line-strong"
                >
                  <span aria-hidden>📎</span>
                  <span className="max-w-40 truncate">{attachment.fileName}</span>
                  <span className="text-muted">
                    {formatNumber(Math.round(attachment.sizeBytes / 1024))} کیلوبایت
                  </span>
                </a>
              ))}
              {issue.attachments.length === 0 && (
                <p className="text-[12px] text-muted">پیوستی نیست</p>
              )}
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-[12px] font-bold tracking-wide text-muted">
              کامنت‌ها ({formatNumber(issue.comments.length)})
            </h2>

            <div className="space-y-3">
              {issue.comments.map((entry) => (
                <div key={entry.id} className="flex gap-2.5">
                  <Avatar member={entry.author} size={28} />
                  <div className="min-w-0 flex-1 rounded-[var(--radius-card)] border border-line bg-surface px-3 py-2">
                    <div className="mb-1 flex items-center gap-2 text-[11px] text-muted">
                      <span className="font-semibold text-ink-2">
                        {entry.author?.fullName ?? "حذف‌شده"}
                      </span>
                      <span>{timeAgo(entry.createdAt)}</span>
                      {entry.editedAt && <span>· ویرایش‌شده</span>}
                      {(entry.author?.id === member?.id || canAdmin) && (
                        <button
                          onClick={async () => {
                            await api.del(`/comments/${entry.id}`);
                            void load();
                          }}
                          className="mr-auto transition-colors hover:text-clay"
                        >
                          حذف
                        </button>
                      )}
                    </div>
                    <RichText body={entry.body} />
                  </div>
                </div>
              ))}
            </div>

            {canWrite && (
              <div className="mt-3 flex gap-2.5">
                <Avatar member={member} size={28} />
                <div className="min-w-0 flex-1 space-y-2">
                  <MentionBox
                    value={comment}
                    onChange={setComment}
                    people={assignables}
                    placeholder="کامنت بنویس… با @ کسی را صدا بزن"
                    onSubmit={() => void postComment()}
                  />
                  <div className="flex items-center gap-2">
                    <Button variant="primary" onClick={() => void postComment()} disabled={!comment.trim()}>
                      ارسال
                    </Button>
                    <span className="text-[11px] text-muted">Ctrl+Enter</span>
                  </div>
                </div>
              </div>
            )}
          </section>

          <ActivityFeed activity={issue.activity} />
        </div>

        <aside className="space-y-3 lg:sticky lg:top-16 lg:self-start">
          <div className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-3">
            <Field label="وضعیت">
              <Select
                disabled={!canWrite}
                value={issue.status.id}
                onChange={(event) => void patch({ statusId: event.target.value })}
              >
                {statuses.map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="مسئول">
              <Select
                disabled={!canWrite}
                value={issue.assignee?.id ?? ""}
                onChange={(event) =>
                  void patch(
                    event.target.value
                      ? { assigneeId: event.target.value }
                      : { clearAssignee: true },
                  )
                }
              >
                <option value="">بدون مسئول</option>
                {assignables.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.fullName}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Field label="نوع">
                <Select
                  disabled={!canWrite}
                  value={issue.type}
                  onChange={(event) => void patch({ type: event.target.value })}
                >
                  {Object.entries(typeLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="اولویت">
                <Select
                  disabled={!canWrite}
                  value={issue.priority}
                  onChange={(event) => void patch({ priority: event.target.value })}
                >
                  {Object.entries(priorityLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field label="اسپرینت">
              <Select
                disabled={!canWrite}
                value={issue.sprintId ?? ""}
                onChange={(event) =>
                  void patch(
                    event.target.value ? { sprintId: event.target.value } : { clearSprint: true },
                  )
                }
              >
                <option value="">بک‌لاگ</option>
                {sprints.map((sprint) => (
                  <option key={sprint.id} value={sprint.id}>
                    {sprint.name}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Field label="امتیاز">
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  disabled={!canWrite}
                  defaultValue={issue.storyPoints ?? ""}
                  onBlur={(event) =>
                    void patch(
                      event.target.value
                        ? { storyPoints: Number(event.target.value) }
                        : { clearPoints: true },
                    )
                  }
                />
              </Field>

              <Field label="مهلت">
                <Input
                  type="date"
                  disabled={!canWrite}
                  defaultValue={toDateInput(issue.dueAt)}
                  onChange={(event) =>
                    void patch(event.target.value ? { dueAt: event.target.value } : { clearDue: true })
                  }
                />
              </Field>
            </div>

            <Field label="برچسب‌ها">
              <div className="flex flex-wrap gap-1.5">
                {labels.map((label) => {
                  const on = issue.labels.some((entry) => entry.id === label.id);
                  return (
                    <button
                      key={label.id}
                      disabled={!canWrite}
                      onClick={() =>
                        void patch({
                          labelIds: on
                            ? issue.labels.filter((entry) => entry.id !== label.id).map((entry) => entry.id)
                            : [...issue.labels.map((entry) => entry.id), label.id],
                        })
                      }
                      style={{ color: label.color, borderColor: on ? label.color : undefined }}
                      className={`rounded border px-2 py-0.5 text-[11px] transition-colors ${
                        on ? "bg-surface-2" : "border-line-strong opacity-60"
                      }`}
                    >
                      {label.name}
                    </button>
                  );
                })}
                {labels.length === 0 && <span className="text-[12px] text-muted">برچسبی تعریف نشده</span>}
              </div>
            </Field>
          </div>

          <div className="space-y-2 rounded-[var(--radius-card)] border border-line bg-surface p-3 text-[12px]">
            <Row label="گزارش‌دهنده">
              <span className="flex items-center gap-1.5">
                <Avatar member={issue.reporter} size={18} />
                {issue.reporter?.fullName ?? "—"}
              </span>
            </Row>
            <Row label="زمان صرف‌شده">
              <span>{issue.spentSeconds > 0 ? formatDuration(issue.spentSeconds) : "—"}</span>
            </Row>
            <Row label="ساخته‌شده">
              <span>{formatDate(issue.createdAt)}</span>
            </Row>
            <Row label="آخرین تغییر">
              <span>{timeAgo(issue.updatedAt)}</span>
            </Row>
            {issue.resolvedAt && (
              <Row label="بسته‌شده">
                <span>{formatDateTime(issue.resolvedAt)}</span>
              </Row>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={async () => {
                await api.post(`/issues/${issue.id}/watch`, { watching: !watching });
                void load();
              }}
            >
              {watching ? "دنبال نکن" : "دنبال کن"}
            </Button>
            {canWrite && <Button onClick={() => setLogging(true)}>ثبت زمان</Button>}
            {canAdmin && (
              <Button
                variant="danger"
                onClick={async () => {
                  if (!confirm(`${issue.key} حذف شود؟ این کار برگشت‌پذیر نیست.`)) return;
                  await api.del(`/issues/${issue.id}`);
                  router.push(`/p/${issue.projectKey}/board`);
                }}
              >
                حذف
              </Button>
            )}
          </div>

          {issue.worklogs.length > 0 && (
            <div className="space-y-1.5 rounded-[var(--radius-card)] border border-line bg-surface p-3">
              <h3 className="text-[12px] font-bold tracking-wide text-muted">زمان‌های ثبت‌شده</h3>
              {issue.worklogs.map((log) => (
                <div key={log.id} className="flex items-center gap-2 text-[12px]">
                  <Avatar member={log.member} size={18} />
                  <span className="flex-1 truncate">{log.note || "بدون توضیح"}</span>
                  <span className="text-muted">{formatDuration(log.seconds)}</span>
                  {log.member.id === member?.id && (
                    <button
                      onClick={async () => {
                        await api.del(`/worklogs/${log.id}`);
                        void load();
                      }}
                      className="text-muted transition-colors hover:text-clay"
                      aria-label="حذف"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>

      <LogWorkModal
        open={logging}
        issueId={issue.id}
        onClose={() => setLogging(false)}
        onLogged={() => void load()}
      />

      <LinkModal
        open={linking}
        issueId={issue.id}
        onClose={() => setLinking(false)}
        onLinked={() => void load()}
      />

      <IssueComposer
        open={subtaskOpen}
        onClose={() => setSubtaskOpen(false)}
        defaultParentId={issue.id}
        onCreated={() => void load()}
      />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted">{label}</span>
      <span className="text-ink-2">{children}</span>
    </div>
  );
}

function LogWorkModal({
  open,
  issueId,
  onClose,
  onLogged,
}: {
  open: boolean;
  issueId: string;
  onClose: () => void;
  onLogged: () => void;
}) {
  const [spent, setSpent] = useState("");
  const [note, setNote] = useState("");
  const [startedAt, setStartedAt] = useState(toDateInput(new Date().toISOString()));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const seconds = parseDuration(spent);
    if (seconds === null || seconds <= 0) {
      setError("مدت را مثل ۲h یا ۹۰m یا ۱h30m بنویس");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await api.post(`/issues/${issueId}/worklogs`, { seconds, note, startedAt });
      setSpent("");
      setNote("");
      onLogged();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? (err.firstFieldError ?? err.message) : "ثبت نشد");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="ثبت زمان">
      <form onSubmit={submit} className="space-y-3">
        <Field label="مدت" hint="مثل ۲h، ۹۰m، یا ۱h30m. عدد تنها یعنی دقیقه.">
          <Input autoFocus value={spent} onChange={(event) => setSpent(event.target.value)} dir="ltr" className="text-left" />
        </Field>
        <Field label="تاریخ" hint="روزی که کار انجام شده، نه روزی که ثبتش می‌کنی.">
          <Input type="date" value={startedAt} onChange={(event) => setStartedAt(event.target.value)} />
        </Field>
        <Field label="توضیح">
          <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="اختیاری" />
        </Field>

        <ErrorNote>{error}</ErrorNote>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onClose}>
            انصراف
          </Button>
          <Button variant="primary" type="submit" loading={busy}>
            ثبت
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function LinkModal({
  open,
  issueId,
  onClose,
  onLinked,
}: {
  open: boolean;
  issueId: string;
  onClose: () => void;
  onLinked: () => void;
}) {
  const [kind, setKind] = useState("relates");
  const [targetKey, setTargetKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/issues/${issueId}/links`, { kind, targetKey });
      setTargetKey("");
      onLinked();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? (err.firstFieldError ?? err.message) : "پیوند ساخته نشد");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="پیوند به ایشیو دیگر">
      <form onSubmit={submit} className="space-y-3">
        <Field label="نوع پیوند">
          <Select value={kind} onChange={(event) => setKind(event.target.value)}>
            {Object.entries(linkLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label.outward}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="کلید ایشیو" hint="مثل KET-42">
          <Input
            autoFocus
            value={targetKey}
            onChange={(event) => setTargetKey(event.target.value)}
            dir="ltr"
            className="text-left"
            required
          />
        </Field>

        <ErrorNote>{error}</ErrorNote>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onClose}>
            انصراف
          </Button>
          <Button variant="primary" type="submit" loading={busy}>
            پیوند
          </Button>
        </div>
      </form>
    </Modal>
  );
}
