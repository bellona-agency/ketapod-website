"use client";

import { Check, Copy, Gift, Loader2 } from "lucide-react";
import { useState } from "react";
import { useSession } from "@/components/account/SessionProvider";
import { useResource } from "@/hooks/useResource";
import { BOOKS, formatDate, getVoice } from "@/lib/catalog";
import { ApiError, getGifts, sendGift } from "@/lib/platform";
import { fmtToman, toLatinDigits } from "@/lib/utils";

/**
 * Give a book to someone.
 *
 * The recipient's phone number is optional, and the form says what each choice
 * means rather than making the sender guess. Filled in, the gift is reserved
 * and a leaked link is useless to anyone else. Left blank, the link *is* the
 * gift — which is what you want for a printed card or a group chat, and is a
 * trade the sender should make knowingly rather than discover.
 *
 * Nothing is sent by SMS here. The spec's flow is a claim link on the web,
 * precisely so the recipient does not need an account — or an app — to accept.
 */
export default function GiftsPage() {
  const { refresh } = useSession();
  const { data, error, reload } = useResource(getGifts, "/account/gifts");

  const [editionId, setEditionId] = useState("");
  const [toPhone, setToPhone] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  /* Flattened once. A gift is of a *performance* — the sender is choosing whose
     voice their friend will hear, which is the whole point of the catalogue. */
  const options = BOOKS.flatMap((b) =>
    b.editions.map((e) => ({
      id: e.id,
      label: `${b.title} — ${getVoice(e.voiceId)?.name ?? "بدون گوینده"}`,
      priceRial: e.priceRial,
    })),
  ).filter((o) => o.priceRial > 0);

  const chosen = options.find((o) => o.id === editionId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!editionId || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await sendGift({
        editionId,
        toPhone: toPhone ? toLatinDigits(toPhone).replace(/\D/g, "") : undefined,
        message,
      });
      setEditionId("");
      setToPhone("");
      setMessage("");
      reload();
      await refresh();
    } catch (err) {
      setFailure(
        err instanceof ApiError
          ? err.code === "insufficient_funds"
            ? "موجودی کیف پول کافی نیست."
            : err.message
          : "ارسال هدیه انجام نشد.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(path: string, code: string) {
    await navigator.clipboard.writeText(`${window.location.origin}${path}`);
    setCopied(code);
    window.setTimeout(() => setCopied(null), 1800);
  }

  return (
    <div>
      <span className="eyebrow text-muted">هدیه</span>
      <h1 className="mt-2 text-[27px] font-bold text-ink sm:text-[34px]">هدیه دادن کتاب</h1>

      <form onSubmit={submit} className="card mt-7 p-6">
        <div className="grid gap-5">
          <div>
            <label htmlFor="edition" className="text-[15px] font-medium text-ink">
              کدام نسخه؟
            </label>
            <select
              id="edition"
              value={editionId}
              onChange={(e) => setEditionId(e.target.value)}
              required
              className="mt-2 h-12 w-full rounded-lg border border-line bg-card px-3 text-[15px] text-ink outline-none focus:border-violet-200"
            >
              <option value="">انتخاب کنید…</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label} — {fmtToman(o.priceRial)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="phone" className="text-[15px] font-medium text-ink">
              شماره‌ی گیرنده <span className="text-faint">(اختیاری)</span>
            </label>
            <input
              id="phone"
              value={toPhone}
              onChange={(e) => setToPhone(e.target.value)}
              inputMode="numeric"
              placeholder="۰۹۱۲۳۴۵۶۷۸۹"
              className="tnum mt-2 h-12 w-full rounded-lg border border-line bg-card px-4 text-[16px] text-ink outline-none focus:border-violet-200"
            />
            <p className="mt-2 text-[13px] leading-[1.85] text-faint">
              اگر شماره بدهید، هدیه فقط با همان شماره دریافت می‌شود. اگر خالی
              بگذارید، هر کسی که لینک را داشته باشد می‌تواند آن را بردارد.
            </p>
          </div>

          <div>
            <label htmlFor="message" className="text-[15px] font-medium text-ink">
              پیام <span className="text-faint">(اختیاری)</span>
            </label>
            <textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              maxLength={280}
              placeholder="چند خط برای گیرنده…"
              className="mt-2 w-full resize-none rounded-lg border border-line bg-card p-4 text-[15px] leading-[1.9] text-ink outline-none focus:border-violet-200"
            />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-line pt-5">
          <button
            type="submit"
            disabled={busy || !editionId}
            className="btn h-12 cursor-pointer rounded-lg bg-violet px-6 text-[16px] font-bold text-white disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : chosen ? (
              `پرداخت ${fmtToman(chosen.priceRial)} و ساخت لینک`
            ) : (
              "ساخت لینک هدیه"
            )}
          </button>
          <p className="text-[13px] text-faint">مبلغ از کیف پول شما کم می‌شود.</p>
        </div>

        {failure && (
          <p role="alert" className="mt-4 text-[14px] text-red-700">
            {failure}
          </p>
        )}
      </form>

      {error && <p className="mt-6 text-[14px] text-muted">{error}</p>}

      {data && data.sent.length > 0 && (
        <section className="mt-10">
          <h2 className="text-[15px] font-bold text-muted">هدیه‌های فرستاده‌شده</h2>
          <ul className="mt-4 flex flex-col gap-2">
            {data.sent.map((g) => (
              <li key={g.id} className="rounded-lg border border-line bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[16px] font-bold text-ink">
                      <Gift className="size-4 text-violet" strokeWidth={1.9} aria-hidden />
                      {g.bookTitle}
                    </p>
                    <p className="tnum mt-1 text-[13px] text-faint">
                      {g.toPhone ? `برای ${g.toPhone}` : "بدون گیرنده‌ی مشخص"} ·{" "}
                      {formatDate(g.createdAt)}
                    </p>
                    {g.message && (
                      <p className="mt-2 text-[14px] leading-[1.85] text-muted">
                        «{g.message}»
                      </p>
                    )}
                  </div>
                  <span
                    className={`chip shrink-0 text-[12px] ${
                      g.claimedAt ? "chip-paper text-mint-ink" : "chip-paper"
                    }`}
                  >
                    {g.claimedAt ? "دریافت شد" : "منتظر دریافت"}
                  </span>
                </div>

                {!g.claimedAt && (
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
                    <code
                      dir="ltr"
                      className="tnum rounded bg-paper-2 px-2.5 py-1.5 text-[14px] font-bold text-ink"
                    >
                      {g.code}
                    </code>
                    <button
                      type="button"
                      onClick={() => void copyLink(g.claimPath, g.code)}
                      className="btn inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3.5 py-1.5 text-[13px] font-medium text-muted transition-colors hover:text-ink"
                    >
                      {copied === g.code ? (
                        <>
                          <Check className="size-3.5" aria-hidden /> کپی شد
                        </>
                      ) : (
                        <>
                          <Copy className="size-3.5" aria-hidden /> کپی لینک دریافت
                        </>
                      )}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
