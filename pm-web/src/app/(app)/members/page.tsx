"use client";

import { useState } from "react";

import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, roleLabels, statusLabels, timeAgo } from "@/lib/format";
import { useResource } from "@/lib/hooks";
import type { Member } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Avatar, Button, ErrorNote, Field, Input, Modal, Select, Skeleton } from "@/components/ui";

/** Who is on the team, what they can do, and the invite flow. */
export default function MembersPage() {
  const { member: me, canAdmin } = useAuth();
  const members = useResource<{ items: Member[] }>("/members");

  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canAdmin) {
    return <p className="p-8 text-center text-[13px] text-muted">این صفحه فقط برای مدیران است.</p>;
  }

  const change = async (id: string, role: string, status: string) => {
    setError(null);
    try {
      await api.patch(`/members/${id}`, { role, status });
      await members.reload();
    } catch (err) {
      setError(err instanceof ApiError ? (err.firstFieldError ?? err.message) : "ذخیره نشد");
    }
  };

  return (
    <div>
      <PageHeader
        title="اعضای تیم"
        subtitle="کسی خودش ثبت‌نام نمی‌کند؛ ورود فقط با دعوت است"
        actions={
          <Button variant="primary" onClick={() => setInviting(true)}>
            + دعوت
          </Button>
        }
      />

      <div className="p-5">
        {error && <ErrorNote>{error}</ErrorNote>}

        {members.loading ? (
          <div className="space-y-1">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-12" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line bg-surface text-[11px] text-muted">
                  <th className="p-3 text-right font-semibold">عضو</th>
                  <th className="p-3 text-right font-semibold">ایمیل</th>
                  <th className="p-3 text-right font-semibold">نقش</th>
                  <th className="p-3 text-right font-semibold">وضعیت</th>
                  <th className="p-3 text-right font-semibold">آخرین فعالیت</th>
                </tr>
              </thead>
              <tbody>
                {members.data?.items.map((person) => (
                  <tr key={person.id} className="border-b border-line last:border-0">
                    <td className="p-3">
                      <span className="flex items-center gap-2">
                        <Avatar member={person} size={26} />
                        <span>
                          {person.fullName || "—"}
                          {person.id === me?.id && (
                            <span className="mr-1 text-[11px] text-muted">(تو)</span>
                          )}
                        </span>
                      </span>
                    </td>
                    <td className="p-3 text-left text-[12px] text-muted" dir="ltr">
                      {person.email}
                    </td>
                    <td className="p-3">
                      <Select
                        value={person.role}
                        onChange={(event) => void change(person.id, event.target.value, person.status)}
                        className="w-28 py-1 text-[12px]"
                      >
                        {Object.entries(roleLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="p-3">
                      <Select
                        value={person.status}
                        onChange={(event) => void change(person.id, person.role, event.target.value)}
                        className="w-28 py-1 text-[12px]"
                      >
                        {Object.entries(statusLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="p-3 text-[12px] text-muted">
                      {person.lastSeenAt ? timeAgo(person.lastSeenAt) : `عضو از ${formatDate(person.createdAt)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-[12px] text-muted">
          بیننده فقط می‌خواند. عضو کار می‌سازد و تغییر می‌دهد. مدیر پروژه می‌سازد و اعضا را
          مدیریت می‌کند. مالک همان مدیر است، به‌علاوه اینکه فقط او می‌تواند مالک تازه بسازد —
          و آخرین مالک فعال را نمی‌شود پایین آورد.
        </p>
      </div>

      <InviteModal
        open={inviting}
        onClose={() => setInviting(false)}
        onInvited={() => void members.reload()}
      />
    </div>
  );
}

function InviteModal({
  open,
  onClose,
  onInvited,
}: {
  open: boolean;
  onClose: () => void;
  onInvited: () => void;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("member");
  const [result, setResult] = useState<{ link: string; emailSent: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await api.post<{ link: string; emailSent: boolean }>("/members/invite", {
        email,
        fullName,
        role,
      });
      setResult(response);
      onInvited();
    } catch (err) {
      setError(err instanceof ApiError ? (err.firstFieldError ?? err.message) : "دعوت ارسال نشد");
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setResult(null);
    setEmail("");
    setFullName("");
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title="دعوت عضو تازه">
      {result ? (
        <div className="space-y-3">
          <p className="text-[13px] text-ink-2">
            {result.emailSent
              ? "ایمیل دعوت فرستاده شد. لینک را هم اینجا داری، محض احتیاط:"
              : "ایمیلی تنظیم نشده، پس لینک را خودت برایش بفرست:"}
          </p>
          <input
            readOnly
            value={result.link}
            dir="ltr"
            onFocus={(event) => event.target.select()}
            className="w-full rounded-[var(--radius-input)] border border-line-strong bg-surface-2 px-3 py-2 text-left text-[12px] text-accent"
          />
          <p className="text-[12px] text-muted">این لینک یک‌بارمصرف است و بعد از هفت روز منقضی می‌شود.</p>
          <div className="flex justify-end">
            <Button variant="primary" onClick={close}>
              تمام
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <Field label="ایمیل">
            <Input
              autoFocus
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              dir="ltr"
              className="text-left"
              required
            />
          </Field>
          <Field label="نام" hint="خودش می‌تواند بعداً عوضش کند">
            <Input value={fullName} onChange={(event) => setFullName(event.target.value)} />
          </Field>
          <Field label="نقش">
            <Select value={role} onChange={(event) => setRole(event.target.value)}>
              {Object.entries(roleLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>

          <ErrorNote>{error}</ErrorNote>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={close}>
              انصراف
            </Button>
            <Button variant="primary" type="submit" loading={busy}>
              ساختن لینک دعوت
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
