"use client";

import { useEffect, useState } from "react";

import { api, query } from "@/lib/api";
import { formatDuration, formatNumber } from "@/lib/format";
import { useProject } from "@/lib/project";
import type { Burndown, CycleTime, Sprint, VelocityEntry, WorkloadEntry } from "@/lib/types";
import { BurndownChart, VelocityChart } from "@/components/Charts";
import { Avatar, Card, Select, Spinner } from "@/components/ui";

export default function ReportsPage() {
  const { project } = useProject();

  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [sprintId, setSprintId] = useState("");
  const [burndown, setBurndown] = useState<Burndown | null>(null);
  const [velocity, setVelocity] = useState<{ items: VelocityEntry[]; average: number } | null>(null);
  const [workload, setWorkload] = useState<WorkloadEntry[]>([]);
  const [cycle, setCycle] = useState<CycleTime | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!project) return;
    void (async () => {
      const base = `/projects/${project.key}`;
      const [all, velocityResult, workloadResult, cycleResult] = await Promise.all([
        api.get<{ items: Sprint[] }>(`${base}/sprints`),
        api.get<{ items: VelocityEntry[]; average: number }>(`${base}/reports/velocity`),
        api.get<{ items: WorkloadEntry[] }>(`${base}/reports/workload`),
        api.get<CycleTime>(`${base}/reports/cycle-time`),
      ]);

      setSprints(all.items);
      setVelocity(velocityResult);
      setWorkload(workloadResult.items);
      setCycle(cycleResult);
      setLoading(false);
    })();
  }, [project]);

  useEffect(() => {
    if (!project) return;
    void (async () => {
      const result = await api.get<Burndown>(
        `/projects/${project.key}/reports/burndown${query({ sprintId })}`,
      );
      setBurndown(result);
    })();
  }, [project, sprintId]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-5 p-5">
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-[14px] font-bold">برن‌داون</h2>
            <p className="text-[12px] text-muted">
              خط فیروزه‌ای کار مانده است، خط‌چین خاکستری مسیر ایده‌آل، و خط‌چین زعفرانی دامنه —
              فاصله‌گرفتن زعفرانی از جای اولش یعنی وسط اسپرینت کار اضافه شده.
            </p>
          </div>
          <Select
            value={sprintId}
            onChange={(event) => setSprintId(event.target.value)}
            className="w-auto"
          >
            <option value="">اسپرینت فعال</option>
            {sprints.map((sprint) => (
              <option key={sprint.id} value={sprint.id}>
                {sprint.name}
              </option>
            ))}
          </Select>
        </div>

        {burndown?.points?.length ? (
          <BurndownChart points={burndown.points} />
        ) : (
          <p className="py-8 text-center text-[13px] text-muted">
            اسپرینت فعالی نیست. یکی را شروع کن تا نمودار معنا پیدا کند.
          </p>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <div className="mb-3">
            <h2 className="text-[14px] font-bold">ولاسیتی</h2>
            <p className="text-[12px] text-muted">
              میله تیره تعهد ابتدای اسپرینت است و میله فیروزه‌ای آنچه واقعاً تمام شد.
              {velocity && velocity.items.length > 0 && (
                <> میانگین: {formatNumber(Math.round(velocity.average * 10) / 10)} امتیاز.</>
              )}
            </p>
          </div>
          <VelocityChart entries={velocity?.items ?? []} />
        </Card>

        <Card>
          <div className="mb-3">
            <h2 className="text-[14px] font-bold">زمان چرخه</h2>
            <p className="text-[12px] text-muted">
              از لحظه‌ای که کار وارد «در حال انجام» می‌شود تا وقتی بسته می‌شود.
            </p>
          </div>
          {cycle && cycle.sampleSize > 0 ? (
            <div className="grid grid-cols-3 gap-3 text-center">
              <Metric label="میانه" value={formatDuration(cycle.medianSeconds)} />
              <Metric label="میانگین" value={formatDuration(cycle.averageSeconds)} />
              <Metric label="نمونه" value={`${formatNumber(cycle.sampleSize)} کار`} />
            </div>
          ) : (
            <p className="py-8 text-center text-[13px] text-muted">
              هنوز کاری بسته نشده که بشود از آن زمان چرخه گرفت.
            </p>
          )}
        </Card>
      </div>

      <Card>
        <div className="mb-3">
          <h2 className="text-[14px] font-bold">بار کاری</h2>
          <p className="text-[12px] text-muted">
            کار باز هر نفر همین حالا، و زمان ثبت‌شده‌اش در دو هفته گذشته.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11px] text-muted">
                <th className="p-2 text-right font-semibold">عضو</th>
                <th className="p-2 text-right font-semibold">کار باز</th>
                <th className="p-2 text-right font-semibold">امتیاز باز</th>
                <th className="p-2 text-right font-semibold">در حال انجام</th>
                <th className="p-2 text-right font-semibold">از مهلت گذشته</th>
                <th className="p-2 text-right font-semibold">زمان ثبت‌شده</th>
              </tr>
            </thead>
            <tbody>
              {workload.map((entry) => (
                <tr key={entry.member.id} className="border-b border-line last:border-0">
                  <td className="p-2">
                    <span className="flex items-center gap-2">
                      <Avatar member={entry.member} size={22} />
                      {entry.member.fullName}
                    </span>
                  </td>
                  <td className="p-2">{formatNumber(entry.openIssues)}</td>
                  <td className="p-2">{formatNumber(entry.openPoints)}</td>
                  <td className="p-2">{formatNumber(entry.inProgress)}</td>
                  <td className={`p-2 ${entry.overdue > 0 ? "font-bold text-clay" : ""}`}>
                    {formatNumber(entry.overdue)}
                  </td>
                  <td className="p-2 text-muted">
                    {entry.spentSeconds > 0 ? formatDuration(entry.spentSeconds) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-input)] border border-line bg-surface-2 p-3">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="text-[14px] font-bold">{value}</p>
    </div>
  );
}
