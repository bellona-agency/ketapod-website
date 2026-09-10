"use client";

import { Check, Copy, Loader2 } from "lucide-react";
import { useState } from "react";
import { useResource } from "@/hooks/useResource";
import { formatDate } from "@/lib/catalog";
import { getReferrals } from "@/lib/platform";
import { fmtToman } from "@/lib/utils";

/**
 * دعوت دوستان.
 *
 * The link points at a *page*, not at an app or a store listing. That is the
 * spec's requirement and its reasoning is about conversion: «لینک دعوت باید
 * صفحه وب باز کند نه اپ، تا کاربر بدون نصب هم بتواند ثبت‌نام کند». Someone who
 * gets this on a desktop, or on a phone with nothing installed, still finishes.
 *
 * The invited list is masked. The inviter is entitled to know their invite
 * worked and whether it counted; they are not entitled to a list of their
 * friends' phone numbers read back to them by us.
 */
export default function InvitePage() {
  const { data, error } = useResource(getReferrals, "/account/invite");
  const [copied, setCopied] = useState<"link" | "code" | null>(null);

  async function copy(what: "link" | "code", text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(what);
    window.setTimeout(() => setCopied(null), 1800);
  }

  if (error) return <p className="py-20 text-center text-muted">{error}</p>;
  if (!data) {
    return <Loader2 className="mx-auto mt-16 size-6 animate-spin text-muted" aria-label="بارگیری" />;
  }

  const url =
    typeof window === "undefined" ? data.invitePath : `${window.location.origin}${data.invitePath}`;

  return (
    <div>
      <span className="eyebrow text-muted">دعوت</span>
      <h1 className="mt-2 text-[27px] font-bold text-ink sm:text-[34px]">دعوت دوستان</h1>

      <p className="mt-3 max-w-[62ch] text-[16px] leading-[1.9] text-muted">
        هر کسی با کد شما ثبت‌نام کند و شنیدن را شروع کند،{" "}
        <strong className="text-ink">{fmtToman(data.rewardRial)}</strong> به کیف پول
        شما و همان مقدار به کیف پول او اضافه می‌شود. پاداش وقتی پرداخت می‌شود که
        واقعاً کتابی گوش داده باشد، نه صرفاً ثبت‌نام کرده باشد.
      </p>

      <div className="card mt-7 p-6">
        <p className="text-[13px] text-muted">کد دعوت شما</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <code
            dir="ltr"
            className="rounded-lg bg-paper-2 px-4 py-2.5 text-[20px] font-bold tracking-wide text-ink"
          >
            {data.code}
          </code>
          <button
            type="button"
            onClick={() => void copy("code", data.code)}
            className="btn inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-4 py-2 text-[14px] font-medium text-muted transition-colors hover:text-ink"
          >
            {copied === "code" ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
            کپی کد
          </button>
        </div>

        <div className="mt-5 border-t border-line pt-5">
          <p className="text-[13px] text-muted">لینک دعوت</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span
              dir="ltr"
              className="min-w-0 flex-1 truncate rounded-lg bg-paper-2 px-4 py-2.5 text-[14px] text-ink-2"
            >
              {url}
            </span>
            <button
              type="button"
              onClick={() => void copy("link", url)}
              className="btn shrink-0 cursor-pointer rounded-lg bg-violet px-5 py-2.5 text-[14px] font-bold text-white"
            >
              {copied === "link" ? "کپی شد" : "کپی لینک"}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="card p-5">
          <p className="text-[13px] text-muted">دعوت‌های پذیرفته‌شده</p>
          <p className="tnum mt-2 text-[24px] font-bold text-ink">
            {data.invited.length.toLocaleString("fa-IR")}
          </p>
        </div>
        <div className="card p-5">
          <p className="text-[13px] text-muted">پاداش دریافتی</p>
          <p className="tnum mt-2 text-[24px] font-bold text-ink">
            {fmtToman(data.earnedRial)}
          </p>
        </div>
      </div>

      {data.invited.length > 0 && (
        <section className="mt-8">
          <h2 className="text-[15px] font-bold text-muted">چه کسانی آمدند</h2>
          <ul className="mt-4 flex flex-col gap-2">
            {data.invited.map((i) => (
              <li
                key={i.phone + i.joinedAt}
                className="flex items-center justify-between gap-4 rounded-lg border border-line bg-card px-5 py-3.5"
              >
                <span>
                  <span className="tnum block text-[15px] text-ink" dir="ltr">
                    {i.phone}
                  </span>
                  <span className="block text-[13px] text-faint">
                    {formatDate(i.joinedAt)}
                  </span>
                </span>
                <span
                  className={`chip chip-paper shrink-0 text-[12px] ${
                    i.activated ? "text-mint-ink" : ""
                  }`}
                >
                  {i.activated ? "پاداش پرداخت شد" : "هنوز شروع نکرده"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
