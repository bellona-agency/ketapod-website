"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Tokens } from "@/lib/types";
import { Button, ErrorNote, Field, Input } from "@/components/ui";

function LoginForm() {
  const { login, applyTokens, member } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Whether this instance has any members yet. Until it does, the form
  // creates the first account instead of asking for a password that
  // cannot exist — the difference between a fresh deploy you can log
  // into and one you have to seed by hand.
  const [needsBootstrap, setNeedsBootstrap] = useState<boolean | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const result = await api.anonymousGet<{ needsBootstrap: boolean }>("/auth/bootstrap");
        setNeedsBootstrap(result.needsBootstrap);
      } catch {
        // If the API is unreachable, show the ordinary login form; the
        // submit will surface the real error.
        setNeedsBootstrap(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (member) router.replace(next);
  }, [member, next, router]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (needsBootstrap) {
        applyTokens(
          await api.anonymous<Tokens>("/auth/bootstrap", { email, fullName, password }),
        );
      } else {
        await login(email, password);
      }
      router.replace(next);
    } catch (err) {
      setError(err instanceof ApiError ? (err.firstFieldError ?? err.message) : "خطا در ورود");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-[var(--radius-input)] bg-accent text-[16px] font-black text-ground">
            ک
          </span>
          <div>
            <h1 className="text-[16px] font-bold">تخته کارهای کتاپاد</h1>
            <p className="text-[12px] text-muted">
              {needsBootstrap ? "اولین حساب را بساز" : "با ایمیل و رمز وارد شو"}
            </p>
          </div>
        </div>

        <form
          onSubmit={submit}
          className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-5"
        >
          {needsBootstrap && (
            <Field label="نام و نام خانوادگی">
              <Input
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                required
                autoComplete="name"
              />
            </Field>
          )}

          <Field label="ایمیل">
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="username"
              dir="ltr"
              className="text-left"
            />
          </Field>

          <Field label="رمز عبور" hint={needsBootstrap ? "حداقل ۸ نویسه" : undefined}>
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoComplete={needsBootstrap ? "new-password" : "current-password"}
              dir="ltr"
              className="text-left"
            />
          </Field>

          <ErrorNote>{error}</ErrorNote>

          <Button type="submit" variant="primary" loading={busy} className="w-full py-2">
            {needsBootstrap ? "ساختن حساب مالک" : "ورود"}
          </Button>

          {needsBootstrap === false && (
            <p className="text-center text-[12px] text-muted">
              حساب نداری؟ از مدیر تیم بخواه دعوتت کند.
            </p>
          )}
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
