"use client";

import { Check, Gift, Loader2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useSession } from "@/components/account/SessionProvider";
import { useResource } from "@/hooks/useResource";
import { ApiError, claimGift, previewGift } from "@/lib/platform";
import { formatTime } from "@/lib/utils";

/**
 * Claiming a gift.
 *
 * Public. The whole point of the spec's web-first gift flow is that the
 * recipient has neither an account nor the app — «جریان کاملاً وب‌محور با لینک
 * دریافت» — so this page shows them what they were sent *before* asking for
 * anything. A login wall in front of the answer to "what is this link" is how a
 * gift link stops converting.
 *
 * Signing in is only required to press the button, and the trip through OTP
 * comes straight back here with `?next=`. An account created at that moment
 * lands with the book already on its shelf.
 */
export default function GiftClaimPage() {
  const params = useParams<{ code: string }>();
  const code = params.code;
  const router = useRouter();
  const { me, status, refresh } = useSession();
  const { data, error, reload } = useResource(() => previewGift(code), `/gift/${code}`);

  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function accept() {
    if (!me) {
      router.push(`/login?next=${encodeURIComponent(`/gift/${code}`)}`);
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const res = await claimGift(code);
      setDone(res.bookTitle);
      reload();
      await refresh();
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : "دریافت انجام نشد.");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <main className="container-k py-24 text-center">
        <p className="text-[17px] text-muted">این لینک هدیه معتبر نیست.</p>
        <Link
          href="/books"
          className="btn mt-5 inline-flex h-11 items-center rounded-lg bg-violet px-5 text-[15px] font-bold text-white"
        >
          دیدن کتاب‌ها
        </Link>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="container-k py-24">
        <Loader2 className="mx-auto size-6 animate-spin text-muted" aria-label="بارگیری" />
      </main>
    );
  }

  const { gift, book } = data;

  return (
    <main className="container-k flex min-h-[70vh] items-center justify-center py-16">
      <div className="w-full max-w-[480px]">
        <div className="card p-8 text-center">
          <span
            className="mx-auto grid size-14 place-items-center rounded-full bg-violet-50 text-violet"
            aria-hidden
          >
            {done ? <Check className="size-7" strokeWidth={2} /> : <Gift className="size-7" strokeWidth={1.7} />}
          </span>

          {done ? (
            <>
              <h1 className="mt-5 text-[24px] font-bold text-ink">هدیه‌تان رسید</h1>
              <p className="mt-2 text-[16px] leading-[1.9] text-muted">
                «{done}» به کتابخانه‌ی شما اضافه شد.
              </p>
              <Link
                href="/library"
                className="btn mt-6 inline-flex h-12 items-center rounded-lg bg-violet px-6 text-[16px] font-bold text-white"
              >
                رفتن به کتابخانه
              </Link>
            </>
          ) : (
            <>
              <h1 className="mt-5 text-[24px] font-bold text-ink">
                {gift.fromName} برای شما کتابی فرستاده
              </h1>

              {book && (
                <div className="mt-5 rounded-lg bg-paper-2 p-5">
                  <p className="text-[19px] font-bold text-ink">{book.title}</p>
                  {book.author && (
                    <p className="mt-1 text-[14px] text-muted">{book.author}</p>
                  )}
                  <p className="tnum mt-2 text-[13px] text-faint">
                    {book.voiceName && <>با صدای {book.voiceName} · </>}
                    {formatTime(book.durationSec)}
                  </p>
                </div>
              )}

              {gift.message && (
                <p className="mt-5 text-[15px] italic leading-[1.95] text-muted">
                  «{gift.message}»
                </p>
              )}

              {gift.claimed ? (
                <p className="mt-6 rounded-lg bg-paper-2 p-4 text-[15px] text-muted">
                  این هدیه قبلاً دریافت شده است.
                </p>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => void accept()}
                    disabled={busy || status === "loading"}
                    className="btn mt-6 h-12 w-full cursor-pointer rounded-lg bg-violet text-[16px] font-bold text-white disabled:opacity-60"
                  >
                    {busy ? (
                      <Loader2 className="mx-auto size-4 animate-spin" aria-hidden />
                    ) : me ? (
                      "دریافت هدیه"
                    ) : (
                      "ورود و دریافت هدیه"
                    )}
                  </button>

                  {!me && status === "anonymous" && (
                    <p className="mt-3 text-[13px] leading-[1.85] text-faint">
                      حساب ندارید؟ با همین شماره‌ی موبایل در چند ثانیه ساخته
                      می‌شود و هدیه مستقیم به کتابخانه‌تان می‌رود.
                    </p>
                  )}
                  {gift.reserved && (
                    <p className="mt-3 text-[13px] text-faint">
                      این هدیه برای یک شماره‌ی مشخص رزرو شده است.
                    </p>
                  )}
                </>
              )}

              {failure && (
                <p role="alert" className="mt-4 text-[14px] text-red-700">
                  {failure}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
