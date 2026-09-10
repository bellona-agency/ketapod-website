"use client";

import Link from "next/link";
import { useState } from "react";

import { ApiError, announceProjectsChanged, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatNumber } from "@/lib/format";
import { useResource } from "@/lib/hooks";
import type { Member, Project } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Avatar, Button, EmptyState, ErrorNote, Field, Input, Modal, Select, Skeleton, Textarea } from "@/components/ui";

export default function ProjectsPage() {
  const { canAdmin } = useAuth();
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);

  const projects = useResource<{ items: Project[] }>(
    `/projects${showArchived ? "?archived=true" : ""}`,
  );

  return (
    <div>
      <PageHeader
        title="پروژه‌ها"
        subtitle="هر پروژه کلید خودش، برد خودش و اسپرینت‌های خودش را دارد"
        actions={
          <>
            <label className="flex items-center gap-2 text-[12px] text-muted">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(event) => setShowArchived(event.target.checked)}
                className="accent-[var(--color-accent)]"
              />
              بایگانی‌شده‌ها
            </label>
            {canAdmin && (
              <Button variant="primary" onClick={() => setCreating(true)}>
                + پروژه تازه
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
        {projects.loading &&
          [0, 1, 2].map((index) => <Skeleton key={index} className="h-28" />)}

        {projects.data?.items.map((project) => (
          <Link
            key={project.id}
            href={`/p/${project.key}/board`}
            className="rounded-[var(--radius-card)] border border-line bg-surface p-4 transition-colors hover:border-line-strong"
          >
            <div className="mb-1 flex items-center gap-2">
              <span
                aria-hidden
                className="size-2.5 rounded-full"
                style={{ backgroundColor: project.color }}
              />
              <h2 className="flex-1 truncate text-[14px] font-bold">{project.name}</h2>
              <span className="latin rounded border border-line-strong px-1.5 text-[11px] text-muted">
                {project.key}
              </span>
            </div>

            {project.description && (
              <p className="mb-2 line-clamp-2 text-[12px] text-muted">{project.description}</p>
            )}

            <div className="flex items-center gap-3 text-[11px] text-muted">
              <span>{formatNumber(project.openCount)} باز</span>
              <span>{formatNumber(project.issueCount)} کل</span>
              {project.lead && (
                <span className="mr-auto flex items-center gap-1">
                  <Avatar member={project.lead} size={18} />
                  {project.lead.fullName}
                </span>
              )}
            </div>

            {project.activeSprint && (
              <p className="mt-2 rounded bg-accent-dim/20 px-2 py-1 text-[11px] text-accent">
                {project.activeSprint.name} — {formatNumber(project.activeSprint.doneCount)} از{" "}
                {formatNumber(project.activeSprint.issueCount)} کار
              </p>
            )}
          </Link>
        ))}
      </div>

      {projects.data?.items.length === 0 && (
        <div className="px-5">
          <EmptyState
            title="پروژه‌ای نیست"
            description={canAdmin ? "اولین پروژه را بساز." : "از مدیر بخواه تو را به پروژه‌ای اضافه کند."}
          />
        </div>
      )}

      <NewProjectModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => void projects.reload()}
      />
    </div>
  );
}

function NewProjectModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const team = useResource<{ items: Member[] }>(open ? "/members" : null);

  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [leadId, setLeadId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post<Project>("/projects", { key, name, description, leadId });
      announceProjectsChanged();
      onCreated();
      setKey("");
      setName("");
      setDescription("");
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? (err.firstFieldError ?? err.message) : "خطا در ساخت پروژه");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="پروژه تازه">
      <form onSubmit={submit} className="space-y-3">
        <Field
          label="کلید"
          hint="۲ تا ۱۰ حرف لاتین بزرگ. همان چیزی که در «KET-142» می‌بینی و در گفتگو می‌گویی."
        >
          <Input
            autoFocus
            value={key}
            onChange={(event) => setKey(event.target.value.toUpperCase())}
            placeholder="KET"
            dir="ltr"
            className="text-left"
            required
          />
        </Field>

        <Field label="نام">
          <Input value={name} onChange={(event) => setName(event.target.value)} required />
        </Field>

        <Field label="توضیح">
          <Textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>

        <Field label="راهبر">
          <Select value={leadId} onChange={(event) => setLeadId(event.target.value)}>
            <option value="">بدون راهبر</option>
            {team.data?.items
              .filter((person) => person.status === "active")
              .map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
          </Select>
        </Field>

        <p className="text-[12px] text-muted">
          برد با چهار ستون پیش‌فرض ساخته می‌شود: برای انجام، در حال انجام، بازبینی، انجام شد.
        </p>

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
