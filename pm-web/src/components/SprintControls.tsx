"use client";

import { useState } from "react";

import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatNumber } from "@/lib/format";
import type { Sprint } from "@/lib/types";

import { Button, ErrorNote, Field, Modal, Select } from "./ui";

/** Start and complete, plus the one number that matters while a sprint
    is running: how much of it is done. */
export function SprintControls({
  sprint,
  sprints,
  onChanged,
}: {
  sprint: Sprint;
  sprints: Sprint[];
  onChanged: () => void;
}) {
  const { canWrite } = useAuth();
  const [completing, setCompleting] = useState(false);
  const [moveTo, setMoveTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const unfinished = sprint.issueCount - sprint.doneCount;
  const futureSprints = sprints.filter(
    (entry) => entry.state === "future" && entry.id !== sprint.id,
  );

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
      setCompleting(false);
    } catch (err) {
      setError(err instanceof ApiError ? (err.firstFieldError ?? err.message) : "خطا");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <span className="text-[12px] text-muted">
        {formatNumber(sprint.doneCount)} از {formatNumber(sprint.issueCount)} کار
        {sprint.points > 0 &&
          ` · ${formatNumber(sprint.donePoints)} از ${formatNumber(sprint.points)} امتیاز`}
        {sprint.endsAt && ` · تا ${formatDate(sprint.endsAt)}`}
      </span>

      {canWrite && sprint.state === "future" && (
        <Button
          loading={busy}
          onClick={() => void run(() => api.post(`/sprints/${sprint.id}/start`))}
        >
          شروع اسپرینت
        </Button>
      )}

      {canWrite && sprint.state === "active" && (
        <Button onClick={() => setCompleting(true)}>بستن اسپرینت</Button>
      )}

      <Modal open={completing} onClose={() => setCompleting(false)} title={`بستن «${sprint.name}»`}>
        <div className="space-y-3">
          <p className="text-[13px] text-ink-2">
            {unfinished > 0
              ? `${formatNumber(unfinished)} کار تمام‌نشده مانده. کجا برود؟`
              : "همه کارهای این اسپرینت تمام شده‌اند."}
          </p>

          {unfinished > 0 && (
            <Field
              label="کارهای تمام‌نشده"
              hint="این کارها در گزارش ولاسیتی همچنان به‌عنوان «تعهدشده» شمرده می‌شوند."
            >
              <Select value={moveTo} onChange={(event) => setMoveTo(event.target.value)}>
                <option value="">برگرد به بک‌لاگ</option>
                {futureSprints.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    برو به {entry.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <ErrorNote>{error}</ErrorNote>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCompleting(false)}>
              انصراف
            </Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={() =>
                void run(() =>
                  api.post(`/sprints/${sprint.id}/complete`, { moveToSprintId: moveTo }),
                )
              }
            >
              بستن اسپرینت
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
