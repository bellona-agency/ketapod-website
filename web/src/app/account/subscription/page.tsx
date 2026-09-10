"use client";

import { Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSession } from "@/components/account/SessionProvider";
import { useResource } from "@/hooks/useResource";
import { formatDate } from "@/lib/catalog";
import {
  ApiError,
  cancelSubscription,
  getSubscription,
  openPayment,
  subscribe,
  type SubscriptionTier,
} from "@/lib/platform";
import { cn, fmtToman } from "@/lib/utils";

/**
 * Plans.
 *
 * The screen says out loud that there is no auto-renew, because the spec is
 * clear that Iranian gateways cannot do it — «درگاه‌های ایرانی تمدید خودکار
 * کامل ندارند» — and a subscription page that stays silent about that is one
 * where every listener discovers it as an outage. Saying it up front turns the
 * same fact into a feature: nothing is charged without you.
 *
 * Two ways to pay, both real. Wallet credit settles immediately; the gateway
 * opens a payment intent and sends the browser away, which is the flow that
 * survives being pointed at Zarinpal.
 */
export default function SubscriptionPage() {
  const router = useRouter();
  const { refresh } = useSession();
  const { data, error, reload } = useResource(getSubscription, "/account/subscription");
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function payFromWallet(tier: SubscriptionTier) {
    setBusy(tier);
    setFailure(null);
    try {
      await subscribe(tier);
      reload();
      await refresh();
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : "فعال‌سازی انجام نشد.");
    } finally {
      setBusy(null);
    }
  }

  async function payAtGateway(tier: SubscriptionTier) {
    setBusy(`gw_${tier}`);
    setFailure(null);
    try {
      const { redirectUrl } = await openPayment({
        purpose: "subscription",
        tier,
        returnPath: "/account/subscription",
      });
      router.push(redirectUrl);
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : "اتصال به درگاه انجام نشد.");
      setBusy(null);
    }
  }

  async function stop() {
    if (!window.confirm("اشتراک تا پایان دوره‌ی پرداخت‌شده فعال می‌ماند. لغو شود؟")) return;
    setBusy("cancel");
    try {
      await cancelSubscription();
      reload();
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  if (error) return <p className="py-20 text-center text-muted">{error}</p>;
  if (!data) {
    return <Loader2 className="mx-auto mt-16 size-6 animate-spin text-muted" aria-label="بارگیری" />;
  }

  const current = data.subscription;

  return (
    <div>
      <span className="eyebrow text-muted">اشتراک</span>
      <h1 className="mt-2 text-[27px] font-bold text-ink sm:text-[34px]">طرح شما</h1>

      {current ? (
        <div
          className={cn(
            "card mt-7 p-6",
            data.renewalDue ? "border-amber-200 bg-amber-50/60" : "border-violet-100 bg-violet-50/50",
          )}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[14px] text-muted">
                {current.status === "cancelled" ? "لغو شده — تا پایان دوره فعال" : "فعال"}
              </p>
              <p className="mt-1 text-[24px] font-bold text-ink">طرح {current.tierName}</p>
              <p className="tnum mt-1.5 text-[14px] text-muted">
                تا {formatDate(current.currentPeriodEnd)} —{" "}
                {current.daysLeft.toLocaleString("fa-IR")} روز مانده
              </p>
            </div>
            {current.status !== "cancelled" && (
              <button
                type="button"
                onClick={() => void stop()}
                disabled={busy !== null}
                className="btn cursor-pointer rounded-lg border border-line bg-card px-4 py-2 text-[14px] font-medium text-muted transition-colors hover:border-red-200 hover:text-red-700 disabled:opacity-60"
              >
                لغو تمدید
              </button>
            )}
          </div>

          {data.renewalDue && (
            <p className="mt-4 text-[14px] leading-[1.9] text-amber-800">
              دوره‌ی شما رو به پایان است. تمدید خودکار نداریم — اگر تمدید نکنید،
              دسترسی به کتاب‌هایی که با اشتراک باز شده‌اند در پایان دوره بسته
              می‌شود. کتاب‌های خریداری‌شده سر جای خود می‌مانند.
            </p>
          )}
        </div>
      ) : (
        <p className="mt-6 max-w-[60ch] text-[16px] leading-[1.9] text-muted">
          اشتراک فعالی ندارید. با اشتراک، بخشی از کاتالوگ بدون خرید تک‌تک باز
          می‌شود؛ کتاب‌هایی که جداگانه خریده‌اید همیشه مال شما می‌مانند.
        </p>
      )}

      {failure && (
        <p role="alert" className="mt-4 text-[14px] text-red-700">
          {failure}
        </p>
      )}

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        {data.tiers.map((tier) => {
          const isCurrent = current?.tier === tier.id;
          const affordable = data.balanceRial >= tier.monthlyRial;
          return (
            <section
              key={tier.id}
              className={cn(
                "card flex flex-col p-6",
                isCurrent && "border-violet-200 ring-1 ring-violet-100",
              )}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-[19px] font-bold text-ink">{tier.name}</h2>
                {isCurrent && (
                  <span className="chip chip-paper text-[12px] text-violet">طرح فعلی</span>
                )}
              </div>
              <p className="tnum mt-2 text-[22px] font-bold text-ink">
                {fmtToman(tier.monthlyRial)}
                <span className="text-[14px] font-medium text-faint"> / ماه</span>
              </p>

              <ul className="mt-4 flex flex-1 flex-col gap-2">
                {tier.perks.map((perk) => (
                  <li key={perk} className="flex gap-2 text-[14px] leading-[1.8] text-muted">
                    <Check className="mt-1 size-3.5 shrink-0 text-mint-ink" aria-hidden />
                    {perk}
                  </li>
                ))}
              </ul>

              <div className="mt-5 grid gap-2">
                <button
                  type="button"
                  onClick={() => void payFromWallet(tier.id)}
                  disabled={busy !== null || !affordable}
                  className="btn h-11 cursor-pointer rounded-lg bg-violet text-[15px] font-bold text-white disabled:opacity-50"
                >
                  {busy === tier.id ? (
                    <Loader2 className="mx-auto size-4 animate-spin" aria-hidden />
                  ) : isCurrent ? (
                    "تمدید از کیف پول"
                  ) : (
                    "پرداخت از کیف پول"
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => void payAtGateway(tier.id)}
                  disabled={busy !== null}
                  className="btn h-11 cursor-pointer rounded-lg border border-line bg-card text-[15px] font-medium text-ink transition-colors hover:border-violet-200 disabled:opacity-60"
                >
                  {busy === `gw_${tier.id}` ? (
                    <Loader2 className="mx-auto size-4 animate-spin" aria-hidden />
                  ) : (
                    "پرداخت با درگاه بانکی"
                  )}
                </button>
                {!affordable && (
                  <p className="tnum text-center text-[12px] text-faint">
                    موجودی کیف پول: {fmtToman(data.balanceRial)}
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {data.history.length > 0 && (
        <section className="mt-10">
          <h2 className="text-[15px] font-bold text-muted">پرداخت‌های اشتراک</h2>
          <ul className="mt-4 flex flex-col gap-2">
            {data.history.map((h) => (
              <li
                key={h.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-line bg-card px-5 py-3.5"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[15px] text-ink">{h.memo}</span>
                  <span className="block text-[13px] text-faint">
                    {formatDate(h.createdAt)}
                  </span>
                </span>
                <span className="tnum shrink-0 text-[15px] font-bold text-ink">
                  {fmtToman(Math.abs(h.amountRial))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
