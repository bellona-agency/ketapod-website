"use client";

import { Loader2, ShieldCheck } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useSession } from "@/components/account/SessionProvider";
import { useResource } from "@/hooks/useResource";
import { getPayment, settlePayment } from "@/lib/platform";
import { fmtToman } from "@/lib/utils";

/**
 * The gateway, stood in for.
 *
 * This page is where the bank's own page would be. It is deliberately styled as
 * an obvious mock — a real payment page must never be imitated convincingly,
 * because the muscle memory it would train is exactly the one phishing relies
 * on. What is *not* mocked is the shape around it: an intent was registered
 * server-side with a fixed amount, this page only reports an outcome, and the
 * server verifies and credits. Replacing this file with a redirect to Zarinpal
 * changes nothing on either side of it.
 *
 * The two buttons are the two things a real gateway can tell you. Everything
 * else — the amount, what it buys, whether it has already settled — comes from
 * the intent, because this page is not trusted with any of it.
 */
export default function PaymentPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { refresh } = useSession();
  const { data, error } = useResource(() => getPayment(id), `/pay/${id}`);
  const [busy, setBusy] = useState(false);

  async function finish(outcome: "paid" | "cancelled") {
    setBusy(true);
    try {
      await settlePayment(id, outcome);
      await refresh();
      /* Back to wherever the payment was started from, with the result in the
         query so that page can say what happened. The path was validated when
         the intent was created, so it cannot point off-site. */
      const back = data?.intent.returnPath ?? "/wallet";
      router.replace(`${back}${back.includes("?") ? "&" : "?"}payment=${outcome}`);
    } catch {
      setBusy(false);
    }
  }

  if (error) return <main className="container-k py-24 text-center text-muted">{error}</main>;
  if (!data) {
    return (
      <main className="container-k py-24">
        <Loader2 className="mx-auto size-6 animate-spin text-muted" aria-label="بارگیری" />
      </main>
    );
  }

  const { intent } = data;
  const settled = intent.status !== "pending";

  return (
    <main className="container-k flex min-h-[70vh] items-center justify-center py-16">
      <div className="w-full max-w-[440px]">
        <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4 text-[13px] leading-[1.9] text-amber-900">
          این صفحه <strong>درگاه واقعی نیست</strong>. جای درگاه بانکی را در
          جریان پرداخت پر می‌کند تا بشود کل مسیر را امتحان کرد. هیچ پولی
          جابه‌جا نمی‌شود.
        </div>

        <div className="card mt-4 p-7">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-full bg-paper-2 text-ink-2" aria-hidden>
              <ShieldCheck className="size-5" strokeWidth={1.7} />
            </span>
            <div>
              <p className="text-[16px] font-bold text-ink">پرداخت اینترنتی</p>
              <p className="tnum text-[13px] text-faint">شناسه: {intent.gatewayRef}</p>
            </div>
          </div>

          <dl className="mt-6 border-t border-line pt-5">
            <div className="flex items-baseline justify-between">
              <dt className="text-[14px] text-muted">مبلغ</dt>
              <dd className="tnum text-[24px] font-bold text-ink">
                {fmtToman(intent.amountRial)}
              </dd>
            </div>
            <div className="mt-3 flex items-baseline justify-between">
              <dt className="text-[14px] text-muted">بابت</dt>
              <dd className="text-[15px] text-ink">
                {intent.purpose === "subscription"
                  ? `اشتراک ${data.tierName ?? ""}`
                  : "شارژ کیف پول"}
              </dd>
            </div>
          </dl>

          {settled ? (
            <div className="mt-6">
              <p className="text-[15px] text-muted">
                این پرداخت قبلاً {intent.status === "paid" ? "انجام شده" : "بسته شده"} است.
              </p>
              <button
                type="button"
                onClick={() => router.replace(intent.returnPath)}
                className="btn mt-4 h-12 w-full cursor-pointer rounded-lg bg-violet text-[16px] font-bold text-white"
              >
                بازگشت
              </button>
            </div>
          ) : (
            <div className="mt-6 grid gap-2">
              <button
                type="button"
                onClick={() => void finish("paid")}
                disabled={busy}
                className="btn h-12 cursor-pointer rounded-lg bg-violet text-[16px] font-bold text-white disabled:opacity-60"
              >
                {busy ? (
                  <Loader2 className="mx-auto size-4 animate-spin" aria-hidden />
                ) : (
                  "پرداخت موفق"
                )}
              </button>
              <button
                type="button"
                onClick={() => void finish("cancelled")}
                disabled={busy}
                className="btn h-12 cursor-pointer rounded-lg border border-line bg-card text-[15px] font-medium text-muted transition-colors hover:text-ink disabled:opacity-60"
              >
                انصراف
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
