"use client";

import { ArrowRight, Loader2, ShieldCheck } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { ApiError, requestOtp, verifyOtp } from "@/lib/platform";

/**
 * OTP sign-in.
 *
 * The spec's identity model is a phone number and nothing else — no password,
 * no email — so this is the only door into the authenticated surface. Two
 * steps, one screen, and the second step never loses the first: a wrong code
 * must not send the visitor back to retype their number.
 *
 * The page is a client component because it is behind no index and needs the
 * browser's fetch to carry the session cookie the verify call sets.
 */
function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  /* Where to land afterwards. A visitor bounced here from /library should end
     up at /library, not at a generic home. */
  const next = params.get("next") || "/library";

  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const codeRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft]);

  async function submitPhone(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await requestOtp(phone);
      setPhone(res.phone);
      /* The mock hands the code back so the demo is usable. Against the real
         core `code` is absent and this simply stays null. */
      setDevCode(res.code ?? null);
      setSecondsLeft(res.expiresInSec);
      setStep("code");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ارتباط برقرار نشد.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await verifyOtp(phone, code);
      /* `refresh()` before navigating so the header re-reads the session it
         renders from; without it the shell still shows the logged-out state
         after the redirect. */
      router.refresh();
      router.push(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ارتباط برقرار نشد.");
      setCode("");
      codeRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container-k flex min-h-[70vh] items-center justify-center py-16">
      <div className="w-full max-w-[420px]">
        <div className="card p-6 sm:p-8">
          <span className="chip chip-paper mb-5" aria-hidden>
            <ShieldCheck className="size-5" strokeWidth={1.6} />
          </span>

          <h1 className="text-[24px] font-bold text-ink">
            {step === "phone" ? "ورود به کتاپاد" : "کد را وارد کنید"}
          </h1>
          <p className="mt-2.5 text-[15px] leading-[1.8] text-muted">
            {step === "phone"
              ? "با شماره موبایل وارد شوید. رمزی در کار نیست — یک کد پیامک می‌شود."
              : `کد شش‌رقمی به ${phone} فرستاده شد.`}
          </p>

          {step === "phone" ? (
            <form onSubmit={submitPhone} className="mt-6 flex flex-col gap-3">
              <label htmlFor="phone" className="text-[14px] font-medium text-ink">
                شماره موبایل
              </label>
              <input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                dir="ltr"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="09xxxxxxxxx"
                className="tnum h-12 rounded-lg border border-line bg-paper-2 px-4 text-[16px] text-ink outline-none transition-colors focus:border-violet"
              />
              <SubmitButton busy={busy} label="ارسال کد" />
            </form>
          ) : (
            <form onSubmit={submitCode} className="mt-6 flex flex-col gap-3">
              <label htmlFor="code" className="text-[14px] font-medium text-ink">
                کد تأیید
              </label>
              <input
                id="code"
                ref={codeRef}
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                dir="ltr"
                required
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="------"
                className="tnum h-12 rounded-lg border border-line bg-paper-2 px-4 text-center text-[20px] tracking-[0.4em] text-ink outline-none transition-colors focus:border-violet"
              />

              {devCode && (
                <p className="rounded-lg bg-violet-50 px-4 py-3 text-[14px] leading-[1.7] text-violet-700">
                  این نسخه پیامک نمی‌فرستد. کد شما:{" "}
                  <strong className="tnum" dir="ltr">
                    {devCode}
                  </strong>
                </p>
              )}

              <SubmitButton busy={busy} label="ورود" />

              <button
                type="button"
                onClick={() => {
                  setStep("phone");
                  setCode("");
                  setError(null);
                }}
                className="mt-1 text-[14px] text-muted underline-offset-4 hover:text-ink hover:underline"
              >
                شماره را عوض می‌کنم
              </button>
              {secondsLeft > 0 && (
                <p className="tnum text-[13px] text-faint">
                  اعتبار کد: {Math.floor(secondsLeft / 60)}:
                  {String(secondsLeft % 60).padStart(2, "0")}
                </p>
              )}
            </form>
          )}

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-[14px] leading-[1.7] text-red-700"
            >
              {error}
            </p>
          )}
        </div>

        <p className="mt-5 text-center text-[13px] leading-[1.8] text-faint">
          با ورود، شرایط استفاده و سیاست حریم خصوصی را می‌پذیرید.
        </p>
      </div>
    </main>
  );
}

function SubmitButton({ busy, label }: { busy: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="btn mt-2 inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-violet px-5 text-[16px] font-bold text-white transition-opacity disabled:opacity-60"
    >
      {busy ? (
        <Loader2 className="size-5 animate-spin" aria-hidden />
      ) : (
        <ArrowRight className="size-5" strokeWidth={2} aria-hidden />
      )}
      {label}
    </button>
  );
}

/** `useSearchParams` needs a Suspense boundary above it to prerender. */
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
