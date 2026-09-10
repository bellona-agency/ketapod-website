"use client";

import { Loader2, TicketPercent } from "lucide-react";
import { useState } from "react";
import { useSession } from "@/components/account/SessionProvider";
import { useResource } from "@/hooks/useResource";
import { ApiError, getPendingDiscount, redeemCode, type RedeemOk } from "@/lib/platform";
import { fmtToman } from "@/lib/utils";

/**
 * One box, for every kind of code.
 *
 * A discount code, a gift card and a book-fair voucher are three things to the
 * ledger and one thing to the person holding them: a string they were given.
 * Asking them to pick the right of three forms first is asking them to know
 * something only we know.
 *
 * The result message differs by kind because the *consequence* differs, and
 * that part they do need to understand — money in the wallet is spendable on
 * anything, a percentage waits for the next purchase and then disappears.
 */
export default function CodesPage() {
  const { refresh } = useSession();
  const { data, reload } = useResource(getPendingDiscount, "/account/codes");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RedeemOk | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setFailure(null);
    setResult(null);
    try {
      const res = await redeemCode(code);
      setResult(res);
      setCode("");
      reload();
      await refresh();
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : "این کد پذیرفته نشد.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <span className="eyebrow text-muted">کد</span>
      <h1 className="mt-2 text-[27px] font-bold text-ink sm:text-[34px]">
        کد تخفیف و کارت هدیه
      </h1>

      <form onSubmit={submit} className="card mt-7 p-6">
        <label htmlFor="code" className="text-[15px] font-medium text-ink">
          کد را وارد کنید
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            id="code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="مثلاً KETAPOD30"
            autoComplete="off"
            /* `ltr` on the field only. The codes are Latin and a code typed
               into an RTL input has its characters laid out right-to-left,
               which makes a correct code look wrong while you are typing it. */
            dir="ltr"
            className="h-12 min-w-[200px] flex-1 rounded-lg border border-line bg-card px-4 text-[16px] tracking-wide text-ink outline-none focus:border-violet-200"
          />
          <button
            type="submit"
            disabled={busy || !code.trim()}
            className="btn h-12 cursor-pointer rounded-lg bg-violet px-6 text-[16px] font-bold text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : "اعمال"}
          </button>
        </div>

        <div aria-live="polite">
          {failure && (
            <p role="alert" className="mt-3 text-[14px] text-red-700">
              {failure}
            </p>
          )}
          {result && (
            <p className="mt-3 rounded-lg bg-mint-50 p-4 text-[14px] leading-[1.85] text-mint-ink">
              {result.kind === "credit" ? (
                <>
                  «{result.label}» اعمال شد — {fmtToman(result.amountRial)} به کیف
                  پول شما اضافه شد.
                </>
              ) : (
                <>
                  «{result.label}» ثبت شد. این تخفیف روی{" "}
                  <strong>خرید بعدی</strong> شما اعمال می‌شود.
                </>
              )}
            </p>
          )}
        </div>
      </form>

      {data?.pending && (
        <div className="card mt-4 flex items-center gap-4 border-violet-100 bg-violet-50/50 p-5">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-violet text-white" aria-hidden>
            <TicketPercent className="size-5" strokeWidth={1.8} />
          </span>
          <p className="text-[15px] leading-[1.8] text-ink">
            <strong className="tnum">{data.pending.percent.toLocaleString("fa-IR")}٪ تخفیف</strong>{" "}
            با کد {data.pending.code} منتظر خرید بعدی شماست.
          </p>
        </div>
      )}

      {/* The seeded codes, printed. Hiding demo fixtures behind a guess makes
          the feature untestable by the person the demo is for. */}
      <section className="mt-8 rounded-lg border border-dashed border-line p-5">
        <h2 className="text-[14px] font-bold text-muted">کدهای نمونه برای امتحان</h2>
        <ul className="mt-3 flex flex-col gap-2 text-[14px] text-muted">
          <li>
            <code dir="ltr" className="rounded bg-paper-2 px-1.5 py-0.5 font-bold text-ink">
              KETAPOD30
            </code>{" "}
            — ۳۰٪ تخفیف روی خرید بعدی
          </li>
          <li>
            <code dir="ltr" className="rounded bg-paper-2 px-1.5 py-0.5 font-bold text-ink">
              HEDIYE500
            </code>{" "}
            — کارت هدیه‌ی ۵۰ هزار تومان
          </li>
          <li>
            <code dir="ltr" className="rounded bg-paper-2 px-1.5 py-0.5 font-bold text-ink">
              KETAB1404
            </code>{" "}
            — بن ۲۰ هزار تومان
          </li>
        </ul>
        <p className="mt-3 text-[13px] leading-[1.85] text-faint">
          ارقام فارسی هم پذیرفته می‌شود — <code dir="ltr">KETAB۱۴۰۴</code> همان کد است.
        </p>
      </section>
    </div>
  );
}
