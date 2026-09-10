"use client";

import { BookHeart, Check } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useSession } from "@/components/account/SessionProvider";

/**
 * Landing for an invite link.
 *
 * A page, not a deep link and not a store redirect. That is the spec's
 * requirement and its reason is conversion: «لینک دعوت باید صفحه وب باز کند نه
 * اپ، تا کاربر بدون نصب هم بتواند ثبت‌نام کند». Whoever opens this — on a
 * desktop, on a phone with nothing installed — can finish signing up right
 * here.
 *
 * The code travels to the login screen in the query string and from there into
 * the OTP verify call, where it is attached to the *new* account only. An
 * existing listener following a friend's link is welcome; they are not a
 * referral, and paying for one would make invite codes worth farming.
 */
export default function JoinPage() {
  const params = useParams<{ code: string }>();
  const code = params.code;
  const { me, status } = useSession();

  return (
    <main className="container-k flex min-h-[70vh] items-center justify-center py-16">
      <div className="w-full max-w-[480px] text-center">
        <span
          className="mx-auto grid size-14 place-items-center rounded-full bg-violet-50 text-violet"
          aria-hidden
        >
          <BookHeart className="size-7" strokeWidth={1.7} />
        </span>

        <h1 className="mt-5 text-[26px] font-bold text-ink sm:text-[32px]">
          دعوت شده‌اید به کتاپاد
        </h1>
        <p className="mt-3 text-[16px] leading-[1.95] text-muted">
          با این کد ثبت‌نام کنید و هدیه‌ی خوش‌آمدگویی بگیرید. کتاب صوتی فارسی با
          انتخاب گوینده، نسخه‌های گویشی و کتاب‌یاری که فقط درباره‌ی آنچه شنیده‌اید
          حرف می‌زند.
        </p>

        <p className="mt-5 inline-block rounded-lg bg-paper-2 px-4 py-2.5 text-[15px] text-muted">
          کد دعوت:{" "}
          <code dir="ltr" className="font-bold text-ink">
            {code}
          </code>
        </p>

        <ul className="mx-auto mt-7 flex max-w-[340px] flex-col gap-2.5 text-right">
          {[
            "هدیه‌ی نقدی در کیف پول، پس از اولین کتابی که گوش می‌دهید",
            "کتاب‌یار روی متن همان چیزی که شنیده‌اید",
            "پروفایل کودک با سقف زمان و گزارش هفتگی",
          ].map((line) => (
            <li key={line} className="flex gap-2.5 text-[15px] leading-[1.85] text-muted">
              <Check className="mt-1 size-4 shrink-0 text-mint-ink" aria-hidden />
              {line}
            </li>
          ))}
        </ul>

        {status !== "loading" && me ? (
          <div className="mt-8">
            <p className="text-[15px] text-muted">
              شما از قبل حساب دارید — کد دعوت فقط برای حساب‌های تازه است.
            </p>
            <Link
              href="/books"
              className="btn mt-4 inline-flex h-12 items-center rounded-lg bg-violet px-6 text-[16px] font-bold text-white"
            >
              رفتن به کاتالوگ
            </Link>
          </div>
        ) : (
          <Link
            href={`/login?new=1&ref=${encodeURIComponent(code)}`}
            className="btn mt-8 inline-flex h-12 items-center rounded-lg bg-violet px-7 text-[16px] font-bold text-white"
          >
            ثبت‌نام با این کد
          </Link>
        )}
      </div>
    </main>
  );
}
