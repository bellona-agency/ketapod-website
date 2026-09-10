"use client";

import { useState } from "react";

import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { roleLabels } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { Avatar, Button, Card, ErrorNote, Field, Input } from "@/components/ui";

export default function ProfilePage() {
  const { member, refreshMember, logout } = useAuth();

  const [fullName, setFullName] = useState(member?.fullName ?? "");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!member) return null;

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setProfileMessage(null);
    try {
      await api.patch("/me", { fullName, timezone: member.timezone });
      await refreshMember();
      setProfileMessage("ذخیره شد");
    } catch (err) {
      setError(err instanceof ApiError ? (err.firstFieldError ?? err.message) : "ذخیره نشد");
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setPasswordMessage(null);
    try {
      await api.post("/me/password", { currentPassword: current, newPassword: next });
      setCurrent("");
      setNext("");
      // Changing a password revokes every other session, including the
      // refresh token this tab holds — so the honest next step is a
      // fresh login rather than pretending nothing happened.
      setPasswordMessage("رمز عوض شد. برای امنیت، همه نشست‌ها بسته شدند.");
      setTimeout(() => void logout(), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? (err.firstFieldError ?? err.message) : "رمز عوض نشد");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="حساب من" />

      <div className="mx-auto max-w-lg space-y-4 p-5">
        {error && <ErrorNote>{error}</ErrorNote>}

        <Card>
          <div className="mb-4 flex items-center gap-3">
            <Avatar member={member} size={44} />
            <div>
              <p className="text-[14px] font-bold">{member.fullName}</p>
              <p className="text-[12px] text-muted" dir="ltr">
                {member.email}
              </p>
              <p className="text-[11px] text-muted">{roleLabels[member.role]}</p>
            </div>
          </div>

          <form onSubmit={saveProfile} className="space-y-3">
            <Field label="نام و نام خانوادگی">
              <Input value={fullName} onChange={(event) => setFullName(event.target.value)} required />
            </Field>
            <div className="flex items-center gap-3">
              <Button variant="primary" type="submit" loading={busy}>
                ذخیره
              </Button>
              {profileMessage && <span className="text-[12px] text-accent">{profileMessage}</span>}
            </div>
          </form>
        </Card>

        <Card>
          <h2 className="mb-3 text-[14px] font-bold">تغییر رمز</h2>
          <form onSubmit={changePassword} className="space-y-3">
            <Field label="رمز فعلی">
              <Input
                type="password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
                required
                autoComplete="current-password"
                dir="ltr"
                className="text-left"
              />
            </Field>
            <Field label="رمز تازه" hint="حداقل ۸ نویسه">
              <Input
                type="password"
                value={next}
                onChange={(event) => setNext(event.target.value)}
                required
                autoComplete="new-password"
                dir="ltr"
                className="text-left"
              />
            </Field>
            <div className="flex items-center gap-3">
              <Button variant="primary" type="submit" loading={busy}>
                تغییر رمز
              </Button>
              {passwordMessage && <span className="text-[12px] text-accent">{passwordMessage}</span>}
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
