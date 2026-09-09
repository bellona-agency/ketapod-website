"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, unlockKids } from "@/lib/platform";
import { cn } from "@/lib/utils";

/**
 * Leaving kids mode.
 *
 * The spec's row: «خروج از حالت کودک — والد — قفل PIN … کودک نباید بتواند خارج
 * شود». The PIN is checked on the server, not here, so the digits are never in
 * the bundle and the check cannot be stepped over from the console — which for
 * a lock whose threat model is a curious seven-year-old holding the device is
 * exactly where a client-side check would fail.
 *
 * The button is deliberately small and unlabelled-looking. A large "exit" is an
 * invitation; this is the shape of a thing meant for the adult in the room.
 */
export function ExitLock({ className }: { className?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await unlockKids(pin);
      router.push("/parent");
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        setErr(`چند لحظه صبر کنید (${error.body?.retryInSec ?? 60} ثانیه).`);
      } else if (error instanceof ApiError && error.status === 403) {
        const left = (error.body as { remaining?: number })?.remaining;
        setErr(left ? `رمز درست نیست. ${left} تلاش مانده.` : "رمز درست نیست.");
      } else {
        setErr("خطا در بررسی رمز.");
      }
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="خروج از حالت کودک"
        className={cn(
          "grid size-10 place-items-center rounded-full bg-white/70 text-faint transition-colors hover:text-ink",
          className,
        )}
      >
        <LogOut className="size-4" strokeWidth={1.8} aria-hidden />
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-night/60 p-5">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-e3"
      >
        <h2 className="text-[19px] font-bold text-ink">رمز والد</h2>
        <p className="mt-1.5 text-[14px] leading-[1.75] text-muted">
          برای خروج از حالت کودک، رمز چهار رقمی را وارد کنید.
        </p>

        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          inputMode="numeric"
          autoComplete="off"
          /* `type=password` rather than text: the point is that the person
             holding the device cannot read it over the adult's shoulder. */
          type="password"
          autoFocus
          aria-label="رمز چهار رقمی"
          className="tnum mt-4 h-14 w-full rounded-lg border border-line bg-paper text-center text-[24px] tracking-[0.5em] text-ink outline-none focus:border-violet"
        />

        {err && <p className="mt-3 text-[14px] text-amber-700">{err}</p>}

        <div className="mt-5 flex gap-3">
          <button
            type="submit"
            disabled={busy || pin.length < 4}
            className="btn h-11 flex-1 rounded-lg bg-violet text-[15px] font-bold text-white disabled:opacity-60"
          >
            خروج
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setPin("");
              setErr(null);
            }}
            className="h-11 rounded-lg border border-line px-5 text-[15px] font-medium text-ink"
          >
            بازگشت
          </button>
        </div>
      </form>
    </div>
  );
}
