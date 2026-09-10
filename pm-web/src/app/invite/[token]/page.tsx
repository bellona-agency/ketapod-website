"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Tokens } from "@/lib/types";
import { Button, ErrorNote, Field, Input } from "@/components/ui";

/**
 * Accepting an invite. The token is in the path rather than the query
 * string on purpose: query strings are what leak into referrer headers
 * and analytics, and this one sets a password.
 */
export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const { applyTokens } = useAuth();
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirm) {
      setError("دو رمز یکسان نیستند");
      return;
    }

    setError(null);
    setBusy(true);
    try {
      applyTokens(
        await api.anonymous<Tokens>("/auth/invites/accept", { token, fullName, password }),
      );
      router.replace("/");
    } catch (err) {
      setError(err instanceof ApiError ? (err.firstFieldError ?? err.message) : "خطا در پذیرش دعوت");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-5"
      >
        <div className="mb-2">
          <h1 className="text-[15px] font-bold">به تیم خوش آمدی</h1>
          <p className="text-[12px] text-muted">یک رمز عبور بساز تا واردت کنیم.</p>
        </div>

        <Field label="نام و نام خانوادگی">
          <Input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            required
            autoComplete="name"
          />
        </Field>

        <Field label="رمز عبور" hint="حداقل ۸ نویسه">
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            autoComplete="new-password"
            dir="ltr"
            className="text-left"
          />
        </Field>

        <Field label="تکرار رمز عبور">
          <Input
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            required
            autoComplete="new-password"
            dir="ltr"
            className="text-left"
          />
        </Field>

        <ErrorNote>{error}</ErrorNote>

        <Button type="submit" variant="primary" loading={busy} className="w-full py-2">
          ساختن حساب و ورود
        </Button>
      </form>
    </main>
  );
}
