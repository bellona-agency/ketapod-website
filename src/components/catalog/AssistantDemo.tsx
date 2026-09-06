"use client";

import { Lock, Send, Sparkles } from "lucide-react";
import { useState } from "react";
import { LeadCta } from "@/components/sections/KidsCta";
import { trackEvent } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * A canned exchange. `context` is the part that matters.
 *
 * The spec calls awareness of where the listener is "the core value of this
 * feature", and says every request must carry `bookId + chapterId +
 * currentTime`. So each answer here shows the position it was answered from —
 * the demo's job is to make that visible, not to hide it behind a chat bubble.
 */
type Exchange = {
  question: string;
  answer: string;
  context: string;
};

const EXCHANGES: Exchange[] = [
  {
    question: "روباه چه چیزی به شازده کوچولو یاد داد؟",
    context: "شازده کوچولو · فصل ۵ «روباه» · دقیقه ۱۰۴",
    answer:
      "روباه مفهوم «اهلی کردن» را به او یاد می‌دهد: اینکه پیوند از دل زمان صرف‌شده ساخته می‌شود، نه از دل شباهت. می‌گوید هزاران روباه دیگر مثل او هستند و هزاران گل مثل گل شازده — چیزی که آن‌ها را یکتا می‌کند، وقتی است که برایشان گذاشته شده. همین‌جاست که جمله معروف کتاب شکل می‌گیرد: «تو برای گلت مسئولی.»",
  },
  {
    question: "تا اینجا چه اتفاقی افتاده؟",
    context: "شازده کوچولو · فصل ۵ «روباه» · دقیقه ۱۰۴",
    answer:
      "خلبان در صحرا فرود اضطراری کرده و شازده کوچولو را دیده است. شازده از سیارک خودش گفته و از گلی که آنجا رها کرده، و از سفرش به هفت سیاره که در هرکدام یک بزرگسال تک‌بعدی دیده — پادشاه، خودپسند، میخواره، تاجر، فانوس‌بان، جغرافی‌دان. حالا روی زمین است و تازه با روباه روبه‌رو شده.",
  },
  {
    question: "چرا نویسنده هفت سیاره را انتخاب کرده؟",
    context: "شازده کوچولو · فصل ۴ «هفت سیاره» · دقیقه ۶۵",
    answer:
      "هر سیاره یک شکل از بزرگسالی است که کودک نمی‌فهمدش: قدرت بدون قلمرو، تحسین بدون مخاطب، فرار از شرم با همان چیزی که شرم‌آور است، مالکیت بر چیزی که نمی‌شود داشت. ترتیبشان هم تصادفی نیست — از بی‌ضررترین به سمت غم‌انگیزترین می‌رود، و فانوس‌بان تنها کسی است که شازده کوچولو دوستش دارد، چون کارش دست‌کم به چیزی بیرون از خودش مربوط است.",
  },
  {
    question: "این کتاب برای چه سنی مناسب است؟",
    context: "شازده کوچولو · اطلاعات کتاب",
    answer:
      "نسخه صوتی با صدای پروانه رحیمی برای هفت سال به بالا تأیید شده و نسخه «نوا — کودک» با سرعت پایین‌تر برای پنج سال به بالا. اما لایه دوم کتاب — بخش‌های مربوط به گل، روباه و مار — معمولاً برای خواننده بزرگسال معنای دیگری دارد؛ بسیاری آن را در دو سن می‌شنوند.",
  },
];

/** Free questions before the gate. The spec's shape: a few, then a lead form. */
const FREE_LIMIT = 3;

/**
 * The public assistant demo.
 *
 * No login, a handful of real answers, then a lead form — the funnel the spec
 * describes, built as the page itself rather than as a screenshot of one.
 *
 * The answers are canned. That is honest for a pre-backend site and it is also
 * the right shape to keep: when the RAG service exists, this component swaps
 * `EXCHANGES` for a fetch and the gate, the context line and the layout all
 * stay exactly as they are.
 */
export function AssistantDemo() {
  const [asked, setAsked] = useState<Exchange[]>([]);

  const remaining = EXCHANGES.filter((e) => !asked.includes(e));
  const gated = asked.length >= FREE_LIMIT;

  function ask(exchange: Exchange) {
    trackEvent("ai_demo_question_asked", "ai", "suggested_question", {
      question: exchange.question,
      index: asked.length + 1,
    });
    setAsked((prev) => [...prev, exchange]);
  }

  return (
    <div className="card overflow-hidden">
      {/* ── Now playing ──────────────────────────────────────────
          The assistant is answering *from a position in a book*, so the demo
          opens by saying which book and where. Without this the exchange below
          is indistinguishable from a general-purpose chatbot. */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-paper-2 px-5 py-4">
        <span className="chip chip-sm chip-paper" aria-hidden>
          <Sparkles className="size-[18px]" strokeWidth={1.6} />
        </span>
        <div className="min-w-0">
          <p className="text-[16px] font-bold text-ink">در حال شنیدن: شازده کوچولو</p>
          <p className="tnum text-[14px] text-muted">فصل ۵ «روباه» · دقیقه ۱۰۴</p>
        </div>
      </div>

      <div className="flex flex-col gap-5 p-5 sm:p-6">
        {asked.length === 0 && (
          <p className="text-[16px] leading-[1.85] text-muted">
            یکی از پرسش‌های زیر را انتخاب کنید. کتاب‌یار از همان نقطه‌ای که در آن هستید پاسخ
            می‌دهد — نه از روی خلاصه‌ای که جای دیگری خوانده باشد.
          </p>
        )}

        {asked.map((exchange, i) => (
          <div key={exchange.question} className="flex flex-col gap-3">
            <p className="self-start rounded-lg rounded-tr-xs bg-violet px-4 py-3 text-[16px] font-medium text-white shadow-e1">
              {exchange.question}
            </p>

            <div className="flex flex-col gap-2 rounded-lg border border-line bg-paper px-4 py-4">
              <p className="tnum text-[13px] text-faint">{exchange.context}</p>
              <p className="text-[16px] leading-[1.9] text-ink-2">{exchange.answer}</p>
            </div>

            {i === asked.length - 1 && !gated && remaining.length > 0 && (
              <p className="tnum text-[13px] text-faint">
                {FREE_LIMIT - asked.length} پرسش رایگان باقی مانده
              </p>
            )}
          </div>
        ))}

        {/* ── Ask, or the gate ─────────────────────────────────── */}
        {gated || remaining.length === 0 ? (
          <div className="flex flex-col items-start gap-4 rounded-lg border border-violet-100 bg-violet-50 p-5">
            <span className="chip chip-sm bg-violet text-white" aria-hidden>
              <Lock className="size-[18px]" strokeWidth={1.7} />
            </span>
            <div>
              <p className="text-[18px] font-bold text-ink">
                برای ادامه گفتگو ثبت‌نام کنید
              </p>
              <p className="mt-1.5 max-w-[48ch] text-[16px] leading-[1.8] text-muted">
                در نسخه کامل، کتاب‌یار روی هر کتابی که می‌شنوید در دسترس است — با پرسش آزاد،
                خلاصه فصل، کوییز و پاسخ صوتی.
              </p>
            </div>
            <LeadCta
              label="ادامه با کتاب‌یار"
              intent={{ interest: "ai" }}
              icon="sparkles"
              event="ai_gate_cta_clicked"
              section="ai"
              element="gate_cta"
            />
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {remaining.map((exchange) => (
              <li key={exchange.question}>
                <button
                  type="button"
                  onClick={() => ask(exchange)}
                  className={cn(
                    "group flex w-full cursor-pointer items-center gap-3 rounded-lg border border-line-2 bg-card px-4 py-3.5 text-right",
                    "transition-[border-color,background-color] duration-200 hover:border-violet hover:bg-violet-50",
                  )}
                >
                  <Send
                    className="size-4 shrink-0 text-faint transition-colors duration-200 group-hover:text-violet"
                    strokeWidth={1.8}
                    aria-hidden
                  />
                  <span className="text-[16px] text-ink-2 transition-colors duration-200 group-hover:text-ink">
                    {exchange.question}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
