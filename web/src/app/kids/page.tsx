import {
  BellOff,
  Clock,
  Moon,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";
import { BookGrid } from "@/components/catalog/BookCard";
import { PageHeader } from "@/components/catalog/PageHeader";
import { PageView } from "@/components/primitives/PageView";
import { Reveal, RevealGroup, RevealItem } from "@/components/primitives/Reveal";
import { Section } from "@/components/primitives/Section";
import { LeadCta } from "@/components/sections/KidsCta";
import { VOICES, getCollection, kidsBooks } from "@/lib/catalog";
import { routes } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "قصه صوتی کودک — کتاپاد کودک",
  description:
    "قصه و کتاب صوتی برای کودکان، با صدای گویندگان تأییدشده، تایمر قصه شب، سقف زمان استفاده و کنترل کامل والد. بدون تبلیغات، بدون محتوای غریبه.",
  path: routes.kids(),
});

/**
 * The kids landing page.
 *
 * Written for the parent, not the child. The spec is explicit that in this part
 * of the product the person who listens does not pay and the person who pays
 * does not listen, and everything on this page follows from that: the copy
 * addresses a parent evaluating a purchase, the guarantees come before the
 * catalogue, and the CTA presets the lead form to `parent`.
 *
 * It is deliberately a full, indexable page rather than a promo for the app —
 * a large share of parents hand a child the home computer rather than a phone,
 * so this surface has to stand on its own.
 */
export default function KidsPage() {
  const books = kidsBooks();
  const voices = VOICES.filter((v) => v.kidsApproved);
  const bedtime = getCollection("gheseh-shab");

  return (
    <>
      <PageView name="kids" />

      <PageHeader
        trail={[
          { name: "کتاپاد", path: routes.home() },
          { name: "کودک", path: routes.kids() },
        ]}
        eyebrow="کتاپاد کودک"
        title="قصه‌ای که خودتان هم شنیده‌اید"
        lead="کاتالوگ تأییدشده، صدای گویندگان کودک، تایمر قصه شب و کنترل کامل شما بر آنچه کودک می‌شنود. کودک انتخاب می‌کند و گوش می‌دهد؛ چارچوب را شما تعیین می‌کنید."
        aside={
          <LeadCta
            label="برای کودکم می‌خواهم"
            intent={{ userType: "parent", interest: "kids" }}
            icon="baby"
            event="kids_page_cta_clicked"
            section="kids_page"
            element="header_cta"
          />
        }
      />

      <main>
        {/* ── The four rules ───────────────────────────────────────
            Guarantees before catalogue: a parent deciding whether to let a
            child use this at all needs the answer to "what can go wrong"
            before "what is on it". */}
        <Section id="kids-rules" shell="light" className="pt-14">
          <h2 className="max-w-[24ch] text-[27px] font-bold text-ink sm:text-[34px]">
            چهار قاعده‌ای که در نسخه کودک شکسته نمی‌شود
          </h2>
          <p className="mt-4 max-w-[58ch] text-[17px] leading-[1.85] text-muted">
            این‌ها تنظیمات نیستند که بشود خاموششان کرد. در سمت سرور اعمال می‌شوند، نه در
            برنامه — یعنی حتی اگر کسی از مسیر دیگری وارد شود، همچنان برقرارند.
          </p>

          <RevealGroup
            className="mt-9 grid gap-x-8 gap-y-7 sm:grid-cols-2"
            stagger={0.08}
            amount={0.15}
          >
            {[
              {
                icon: <ShieldCheck className="size-5" strokeWidth={1.6} />,
                title: "هیچ تبلیغی، در هیچ شکلی",
                body: "نه بنر، نه محتوای حمایت‌شده، نه پیشنهاد خرید در تجربه کودک. این خط قرمز اعتماد است.",
              },
              {
                icon: <Sparkles className="size-5" strokeWidth={1.6} />,
                title: "بدون ورودی متن آزاد به هوش مصنوعی",
                body: "کودک فقط از میان پرسش‌های از پیش تعریف‌شده انتخاب می‌کند. این یک تصمیم ایمنی است، نه یک محدودیت محصولی.",
              },
              {
                icon: <UsersRound className="size-5" strokeWidth={1.6} />,
                title: "بدون محتوای کاربران غریبه",
                body: "کاتالوگ کودک فقط شامل آثار تأییدشده است. نه نظر، نه بحث، نه رتبه‌بندی با غریبه‌ها.",
              },
              {
                icon: <BellOff className="size-5" strokeWidth={1.6} />,
                title: "هیچ نوتیفیکیشنی به دستگاه کودک",
                body: "همه اعلان‌ها به گوشی شما می‌روند. محصول نباید ابزاری برای بازگرداندن کودک به صفحه باشد.",
              },
            ].map((rule) => (
              <RevealItem key={rule.title} className="group flex gap-3.5">
                <span className="chip chip-sm chip-paper chip-tilt" aria-hidden>
                  {rule.icon}
                </span>
                <div className="min-w-0">
                  <h3 className="text-[18px] font-bold text-ink">{rule.title}</h3>
                  <p className="mt-1.5 text-[16px] leading-[1.85] text-muted">{rule.body}</p>
                </div>
              </RevealItem>
            ))}
          </RevealGroup>
        </Section>

        {/* ── Parent controls ──────────────────────────────────── */}
        <section id="parent-controls" className="section-rhythm">
          <div className="container-k">
            <span className="eyebrow">پنل والد</span>
            <h2 className="mt-4 max-w-[22ch] text-[27px] font-bold text-ink sm:text-[34px]">
              یک حساب، چند پروفایل کودک
            </h2>
            <p className="mt-4 max-w-[58ch] text-[17px] leading-[1.85] text-muted">
              پروفایل کودک زیرمجموعه حساب شماست، نه یک حساب جدا. یعنی یک اشتراک، یک کیف پول،
              و کنترلی که واقعاً در دست شماست.
            </p>

            <RevealGroup
              className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
              stagger={0.07}
              amount={0.1}
            >
              {[
                {
                  icon: <UserRoundCheck className="size-5" strokeWidth={1.6} />,
                  title: "پروفایل و سن",
                  body: "برای هر کودک یک پروفایل با سن، زبان یا گویش و فیلترهای خودش.",
                },
                {
                  icon: <Clock className="size-5" strokeWidth={1.6} />,
                  title: "سقف زمان روزانه",
                  body: "شما تنظیم می‌کنید، دستگاه اعمال می‌کند — حتی وقتی آفلاین است.",
                },
                {
                  icon: <ShieldCheck className="size-5" strokeWidth={1.6} />,
                  title: "تأیید یا رد محتوا",
                  body: "کاتالوگ را روی صفحه بزرگ مرور کنید و لیست سفید و سیاه خودتان را بسازید.",
                },
                {
                  icon: <Moon className="size-5" strokeWidth={1.6} />,
                  title: "گزارش هفتگی",
                  body: "کودکم چه گوش داد، چقدر، و چه چیزی را نیمه‌کاره رها کرد.",
                },
              ].map((item) => (
                <RevealItem key={item.title}>
                  <div className="card group flex h-full flex-col gap-3 p-6">
                    <span className="chip chip-paper chip-tilt" aria-hidden>
                      {item.icon}
                    </span>
                    <h3 className="text-[18px] font-bold text-ink">{item.title}</h3>
                    <p className="text-[16px] leading-[1.8] text-muted">{item.body}</p>
                  </div>
                </RevealItem>
              ))}
            </RevealGroup>
          </div>
        </section>

        {/* ── Bedtime ──────────────────────────────────────────── */}
        {bedtime && (
          <Section id="kids-bedtime" shell="deep">
            <div className="flex flex-col items-start gap-6">
              <span className="chip chip-violet" aria-hidden>
                <Moon className="size-5" strokeWidth={1.6} />
              </span>
              <h2 className="max-w-[20ch] text-[27px] font-bold text-night-ink sm:text-[34px]">
                {bedtime.title}
              </h2>
              <p className="max-w-[58ch] text-[17px] leading-[1.85] text-night-muted">
                {bedtime.description} با تایمر خواب، پخش پس از پایان قصه خودش متوقف می‌شود —
                پرکاربردترین سناریوی این بخش، و به همین دلیل در صفحه اول است نه پشت سه کلیک.
              </p>
              <Link
                href={routes.collection(bedtime.slug)}
                className="btn btn-onnight"
              >
                دیدن قصه‌های شب
              </Link>
            </div>
          </Section>
        )}

        {/* ── Catalogue ────────────────────────────────────────── */}
        <section id="kids-catalog" className="section-rhythm">
          <div className="container-k">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-[27px] font-bold text-ink sm:text-[34px]">کاتالوگ کودک</h2>
                <p className="mt-2 max-w-[54ch] text-[16px] text-muted">
                  فقط آثاری که دست‌کم یک نسخه صوتی تأییدشده برای کودک دارند — نه هر کتابی که
                  در دسته کودک قرار می‌گیرد.
                </p>
              </div>
              <p className="tnum text-[15px] text-muted">{books.length} عنوان</p>
            </div>

            <Reveal amount={0.05} className="mt-8">
              <BookGrid books={books} />
            </Reveal>
          </div>
        </section>

        {/* ── Voices ───────────────────────────────────────────── */}
        <section id="kids-voices" className="section-rhythm">
          <div className="container-k">
            <h2 className="text-[27px] font-bold text-ink sm:text-[34px]">
              صداهای تأییدشده کودک
            </h2>
            <p className="mt-2 max-w-[58ch] text-[16px] text-muted">
              اجرای کودک با اجرای بزرگسال فرق دارد: جمله‌های کوتاه‌تر، مکث‌های بلندتر و دامنه
              صوتی محدودتر. این صداها برای همین تنظیم شده‌اند.
            </p>

            <Reveal amount={0.05} className="mt-7">
              <ul className="flex flex-wrap gap-3">
                {voices.map((voice) => (
                  <li key={voice.id}>
                    <Link href={routes.voice(voice.slug)} className="lift card group block p-5">
                      <span className="block text-[17px] font-bold text-ink transition-colors duration-200 group-hover:text-violet">
                        {voice.name}
                      </span>
                      <span className="mt-1 block text-[15px] text-muted">{voice.timbre}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </section>

        {/* ── Close ────────────────────────────────────────────── */}
        <Section id="kids-cta" shell="night">
          <div className="flex flex-col items-center gap-6 text-center">
            <h2 className="max-w-[24ch] text-[27px] font-bold text-night-ink sm:text-[34px]">
              اول شما تصمیم می‌گیرید، بعد کودک انتخاب می‌کند
            </h2>
            <p className="max-w-[52ch] text-[17px] leading-[1.85] text-night-muted">
              فرم را پر کنید تا دسترسی زودهنگام کتاپاد کودک و راهنمای تنظیم پروفایل برایتان
              ارسال شود.
            </p>
            <LeadCta
              label="ثبت‌نام والدین"
              intent={{ userType: "parent", interest: "kids" }}
              icon="baby"
              event="kids_page_cta_clicked"
              section="kids_page"
              element="footer_cta"
            />
          </div>
        </Section>
      </main>
    </>
  );
}
