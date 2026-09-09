"use client";

import { ArrowDownLeft, ArrowUpRight, Loader2, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatDate } from "@/lib/catalog";
import { ApiError, getWallet, topUp, type LedgerEntry } from "@/lib/platform";

/**
 * Wallet and ledger.
 *
 * The balance shown is the one the server derives by summing the ledger, never
 * a number this page keeps and adjusts. That is the spec's rule, and the reason
 * a top-up here refetches rather than adding to a local total: if the two ever
 * disagreed, the history is the truth and the total is the guess.
 *
 * Amounts are stored in Rial and displayed in Toman, matching the public pages.
 */

const PRESETS = [500_000, 1_000_000, 2_000_000, 5_000_000];

export default function WalletPage() {
  const router = useRouter();
  const [balance, setBalance] = useState<number | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getWallet();
        if (cancelled) return;
        setBalance(data.balanceRial);
        setEntries(data.entries);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login?next=/wallet");
          return;
        }
        setError("کیف پول بارگیری نشد.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function charge(amountRial: number) {
    setBusy(amountRial);
    setError(null);
    try {
      await topUp(amountRial);
      /* Refetch rather than trusting the returned number — same reason the
         balance is derived in the first place: the ledger is the record and the
         total is only ever a reading of it. */
      const data = await getWallet();
      setBalance(data.balanceRial);
      setEntries(data.entries);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "شارژ انجام نشد.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="container-k py-12 sm:py-16">
      <span className="eyebrow text-muted">کیف پول</span>
      <h1 className="mt-2 text-[27px] font-bold text-ink sm:text-[34px]">اعتبار شما</h1>

      <div className="card mt-7 flex flex-wrap items-center justify-between gap-5 p-6 sm:p-8">
        <div className="flex items-center gap-4">
          <span className="chip chip-paper" aria-hidden>
            <Wallet className="size-5" strokeWidth={1.6} />
          </span>
          <div>
            <p className="text-[14px] text-muted">موجودی</p>
            <p className="tnum mt-1 text-[28px] font-bold text-ink">
              {balance === null
                ? "—"
                : `${Math.round(balance / 10).toLocaleString("fa-IR")} تومان`}
            </p>
          </div>
        </div>
      </div>

      <section className="mt-9">
        <h2 className="text-[15px] font-bold text-muted">شارژ کیف پول</h2>
        <p className="mt-2 max-w-[52ch] text-[15px] leading-[1.8] text-muted">
          در نسخه نهایی این مرحله به درگاه بانکی می‌رود. اینجا مستقیم به دفتر کل
          اضافه می‌شود تا جریان خرید قابل امتحان باشد.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          {PRESETS.map((rial) => (
            <button
              key={rial}
              type="button"
              disabled={busy !== null}
              onClick={() => charge(rial)}
              className="btn inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-card px-5 text-[15px] font-bold text-ink transition-colors hover:border-violet-200 disabled:opacity-60"
            >
              {busy === rial && <Loader2 className="size-4 animate-spin" aria-hidden />}
              <span className="tnum">
                {Math.round(rial / 10).toLocaleString("fa-IR")} تومان
              </span>
            </button>
          ))}
        </div>
        {error && (
          <p role="alert" className="mt-4 text-[14px] text-red-700">
            {error}
          </p>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-[15px] font-bold text-muted">گردش حساب</h2>
        <ul className="mt-4 flex flex-col gap-2">
          {entries.map((e) => {
            const credit = e.amountRial > 0;
            return (
              <li
                key={e.id}
                className="flex items-center gap-4 rounded-lg border border-line bg-card px-5 py-4"
              >
                <span
                  className={`grid size-9 shrink-0 place-items-center rounded-full ${
                    credit ? "bg-mint-100 text-mint-ink" : "bg-paper-2 text-ink-2"
                  }`}
                  aria-hidden
                >
                  {credit ? (
                    <ArrowDownLeft className="size-4" strokeWidth={2} />
                  ) : (
                    <ArrowUpRight className="size-4" strokeWidth={2} />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-ink">
                    {e.memo}
                  </span>
                  <span className="block text-[13px] text-faint">
                    {formatDate(e.createdAt)}
                  </span>
                </span>
                <span
                  dir="ltr"
                  className={`tnum shrink-0 text-[15px] font-bold ${
                    credit ? "text-mint-ink" : "text-ink"
                  }`}
                >
                  {credit ? "+" : "−"}
                  {Math.round(Math.abs(e.amountRial) / 10).toLocaleString("fa-IR")}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
