"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useSession } from "@/components/account/SessionProvider";
import { useResource } from "@/hooks/useResource";
import { formatDate } from "@/lib/catalog";
import { ApiError, getOrders, refundOrder } from "@/lib/platform";
import { fmtToman } from "@/lib/utils";

/**
 * Purchases, and the refund button.
 *
 * Whether a purchase can be refunded is decided by the server and arrives as a
 * boolean with a sentence explaining a `false`. Nothing on this page recomputes
 * it from the date and the progress bar, even though both are right here — the
 * moment it did, the seven-day window would exist in two places and the button
 * would eventually offer something the endpoint refuses.
 *
 * The blocked reason is shown rather than the button being merely greyed out.
 * "چرا نمی‌توانم" is the actual question, and a disabled button never answers it.
 */
export default function OrdersPage() {
  const { data, error, reload } = useResource(getOrders, "/account/orders");
  const { refresh } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function refund(orderId: string) {
    if (!window.confirm("مبلغ به کیف پول برمی‌گردد و کتاب از کتابخانه حذف می‌شود. ادامه؟")) {
      return;
    }
    setBusy(orderId);
    setFailure(null);
    try {
      await refundOrder(orderId);
      reload();
      await refresh();
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : "بازپرداخت انجام نشد.");
    } finally {
      setBusy(null);
    }
  }

  if (error) return <p className="py-20 text-center text-muted">{error}</p>;
  if (!data) {
    return <Loader2 className="mx-auto mt-16 size-6 animate-spin text-muted" aria-label="بارگیری" />;
  }

  return (
    <div>
      <span className="eyebrow text-muted">خرید</span>
      <h1 className="mt-2 text-[27px] font-bold text-ink sm:text-[34px]">خریدها</h1>

      <p className="mt-3 max-w-[62ch] text-[15px] leading-[1.9] text-muted">
        تا {data.policy.windowDays.toLocaleString("fa-IR")} روز پس از خرید و تا وقتی
        بیش از {data.policy.maxProgressPercent.toLocaleString("fa-IR")}٪ کتاب را
        نشنیده‌اید، می‌توانید بازپرداخت بگیرید. مبلغ به کیف پول برمی‌گردد.
      </p>

      {failure && (
        <p role="alert" className="mt-4 text-[14px] text-red-700">
          {failure}
        </p>
      )}

      {data.orders.length === 0 ? (
        <div className="card mt-8 p-10 text-center">
          <p className="text-[16px] text-muted">هنوز خریدی نکرده‌اید.</p>
          <Link
            href="/books"
            className="btn mt-4 inline-flex h-11 items-center rounded-lg bg-violet px-5 text-[15px] font-bold text-white"
          >
            دیدن کتاب‌ها
          </Link>
        </div>
      ) : (
        <ul className="mt-7 flex flex-col gap-2">
          {data.orders.map((o) => (
            <li key={o.id} className="rounded-lg border border-line bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[16px] font-bold text-ink">
                    {o.bookSlug ? (
                      <Link href={`/book/${o.bookSlug}`} className="hover:text-violet">
                        {o.bookTitle}
                      </Link>
                    ) : (
                      o.bookTitle
                    )}
                  </p>
                  <p className="mt-1 text-[13px] text-faint">
                    {o.voiceName && <>با صدای {o.voiceName} · </>}
                    {formatDate(o.createdAt)}
                    {o.progress > 0 && (
                      <> · {o.progress.toLocaleString("fa-IR")}٪ شنیده‌شده</>
                    )}
                  </p>
                </div>

                <div className="shrink-0 text-left">
                  <p
                    className={`tnum text-[16px] font-bold ${
                      o.status === "refunded" ? "text-faint line-through" : "text-ink"
                    }`}
                  >
                    {fmtToman(o.priceRial)}
                  </p>
                  {o.refundable ? (
                    <button
                      type="button"
                      onClick={() => void refund(o.id)}
                      disabled={busy !== null}
                      className="btn mt-2 cursor-pointer rounded-lg border border-line px-3.5 py-1.5 text-[13px] font-medium text-muted transition-colors hover:border-red-200 hover:text-red-700 disabled:opacity-60"
                    >
                      {busy === o.id ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      ) : (
                        "درخواست بازپرداخت"
                      )}
                    </button>
                  ) : (
                    <p className="mt-2 text-[12px] text-faint">{o.refundBlockedBecause}</p>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
