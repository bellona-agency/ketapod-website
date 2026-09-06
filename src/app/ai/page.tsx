import { BookOpen, Compass, ListChecks, Mic, Quote, Search } from "lucide-react";
import type { Metadata } from "next";
import { AssistantDemo } from "@/components/catalog/AssistantDemo";
import { PageHeader } from "@/components/catalog/PageHeader";
import { PageView } from "@/components/primitives/PageView";
import { Reveal, RevealGroup, RevealItem } from "@/components/primitives/Reveal";
import { Section } from "@/components/primitives/Section";
import { LeadCta } from "@/components/sections/KidsCta";
import { routes } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "کتاب‌یار — گفتگو با کتابی که می‌شنوید",
  description:
    "کتاب‌یار می‌داند کجای کتاب هستید. بپرسید، خلاصه فصل بگیرید، کوییز بزنید و بحث کنید — بدون اسپویل و بدون ترک کردن پخش.",
  path: routes.ai(),
});

const CAPABILITIES = [
  {
    icon: <Compass className="size-5" strokeWidth={1.6} />,
    title: "می‌داند کجای کتاب هستید",
    body: "هر پرسش با شناسه کتاب، فصل و ثانیه جاری فرستاده می‌شود. یعنی پاسخ هیچ‌وقت جلوتر از جایی که رسیده‌اید نمی‌رود — و اسپویل نمی‌دهد.",
  },
  {
    icon: <BookOpen className="size-5" strokeWidth={1.6} />,
    title: "خلاصه کتاب و خلاصه فصل",
    body: "برگشتید و یادتان نیست کجا بودید؟ خلاصه‌ای از آنچه تا این لحظه شنیده‌اید، نه از کل کتاب.",
  },
  {
    icon: <ListChecks className="size-5" strokeWidth={1.6} />,
    title: "کوییز از محتوا",
    body: "چند پرسش کوتاه از همان فصل، برای وقتی که می‌خواهید بدانید چقدر مانده است.",
  },
  {
    icon: <Search className="size-5" strokeWidth={1.6} />,
    title: "جستجوی معنایی",
    body: "«کتابی می‌خواهم درباره تنهایی که تلخ نباشد» — پرسش را به زبان خودتان بپرسید، نه با کلیدواژه.",
  },
  {
    icon: <Mic className="size-5" strokeWidth={1.6} />,
    title: "پرسش با صدا",
    body: "هدفون در گوش و دست مشغول است. در اپ موبایل می‌توانید بدون توقف پخش، با صدا بپرسید.",
  },
  {
    icon: <Quote className="size-5" strokeWidth={1.6} />,
    title: "روی متن واقعی کتاب",
    body: "پاسخ‌ها از ترنسکریپت همگام همان نسخه صوتی می‌آیند، نه از دانش عمومی درباره کتاب.",
  },
];

/**
 * The assistant's public page.
 *
 * The spec names this the main acquisition funnel and gives it a precise shape:
 * no login, a few free questions, then a lead form. So the demo is the first
 * thing on the page and the explanation comes after it — a visitor who has
 * already asked something reads the capability list differently from one who
 * has only been told about it.
 */
export default function AiPage() {
  return (
    <>
      <PageView name="ai" />

      <PageHeader
        trail={[
          { name: "کتاپاد", path: routes.home() },
          { name: "کتاب‌یار", path: routes.ai() },
        ]}
        eyebrow="کتاب‌یار"
        title="با کتابی که می‌شنوید حرف بزنید"
        lead="کتاب‌یار یک چت عمومی درباره کتاب‌ها نیست. می‌داند کدام کتاب، کدام فصل و کدام دقیقه — و از همان‌جا پاسخ می‌دهد. بدون ثبت‌نام امتحانش کنید."
      />

      <main>
        <section className="section-rhythm pt-12">
          <div className="container-k">
            <Reveal amount={0.05} className="mx-auto max-w-3xl">
              <AssistantDemo />
            </Reveal>
          </div>
        </section>

        <section className="section-rhythm">
          <div className="container-k">
            <h2 className="max-w-[22ch] text-[27px] font-bold text-ink sm:text-[34px]">
              چه کارهایی می‌کند
            </h2>

            <RevealGroup
              className="mt-9 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3"
              stagger={0.06}
              amount={0.1}
            >
              {CAPABILITIES.map((item) => (
                <RevealItem key={item.title} className="group flex flex-col gap-3">
                  <span className="chip chip-paper chip-tilt" aria-hidden>
                    {item.icon}
                  </span>
                  <h3 className="text-[19px] font-bold text-ink">{item.title}</h3>
                  <p className="text-[16px] leading-[1.85] text-muted">{item.body}</p>
                </RevealItem>
              ))}
            </RevealGroup>
          </div>
        </section>

        {/* The technical claim behind all of it, stated plainly. It is also the
            page's answer to "how is this different from asking a chatbot". */}
        <Section id="ai-transcript" shell="deep">
          <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div className="flex flex-col gap-5">
              <span className="eyebrow text-night-muted">چطور کار می‌کند</span>
              <h2 className="max-w-[22ch] text-[27px] font-bold text-night-ink sm:text-[34px]">
                از متن کتاب، نه از اینترنت
              </h2>
              <p className="max-w-[54ch] text-[17px] leading-[1.9] text-night-muted">
                هر نسخه صوتی در کتاپاد یک ترنسکریپت همگام با زمان دارد — نگاشت جمله‌به‌جمله متن
                به ثانیه. کتاب‌یار پاسخ‌ها را از همین ساختار می‌سازد. به همین دلیل می‌تواند بگوید
                «تا اینجا چه گذشت» بدون آنکه چیزی از ادامه لو بدهد، و به همین دلیل نقل‌قولی که
                می‌آورد واقعاً در کتاب هست.
              </p>
              <p className="max-w-[54ch] text-[16px] leading-[1.9] text-night-muted">
                همان ترنسکریپت سه کار دیگر هم می‌کند: دسترس‌پذیری برای شنونده ناشنوا، روشن‌شدن
                کلمه در حال خوانده‌شدن برای کودکی که خواندن یاد می‌گیرد، و متن ایندکس‌پذیری که
                صفحه هر کتاب را از یک پاراگراف توضیح فراتر می‌برد.
              </p>
            </div>

            <ol className="flex flex-col gap-3">
              {[
                "متن کتاب استخراج و نرمال‌سازی می‌شود",
                "واژه‌نامه تلفظ روی اسامی خاص اعمال می‌شود",
                "صوت تولید و ترنسکریپت همگام ساخته می‌شود",
                "پرسش شما با شناسه کتاب، فصل و ثانیه فرستاده می‌شود",
                "پاسخ فقط از بخش شنیده‌شده ساخته می‌شود",
              ].map((step, i) => (
                <li
                  key={step}
                  className="flex items-start gap-4 rounded-lg border border-night-line bg-white/[0.04] px-5 py-4"
                >
                  <span className="tnum shrink-0 text-[15px] font-bold text-violet-200">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-[16px] leading-[1.75] text-night-ink">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </Section>

        <Section id="ai-cta" shell="light">
          <div className="flex flex-col items-center gap-6 text-center">
            <h2 className="max-w-[24ch] text-[27px] font-bold text-ink sm:text-[34px]">
              روی هر کتابی که می‌شنوید
            </h2>
            <p className="max-w-[52ch] text-[17px] leading-[1.85] text-muted">
              ثبت‌نام کنید تا کتاب‌یار روی کل کتابخانه‌تان فعال شود — با پرسش آزاد، پاسخ صوتی و
              کوییز.
            </p>
            <LeadCta
              label="شروع با کتاب‌یار"
              intent={{ interest: "ai" }}
              icon="sparkles"
              event="ai_page_cta_clicked"
              section="ai"
              element="footer_cta"
            />
          </div>
        </Section>
      </main>
    </>
  );
}
