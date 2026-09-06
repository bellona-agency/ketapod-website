/**
 * Static page copy.
 *
 * Per design-web-v1.1-HomePage: every string here is fixed in the front-end and
 * must NOT be read from the database/API. Only Trust Strip, Demo, Localization,
 * Social Proof and the Lead-Form options are dynamic — those live in `api.ts`.
 */

import { routes } from "./routes";

export const PRIMARY_CTA_LABEL = "رایگان گوش کن";

/* ── 1) Header ────────────────────────────────────────────────────────────
   The primary nav moved to `lib/routes.ts` when the site stopped being one
   page: it is a list of URLs now, and it belongs next to the route builders
   that produce them rather than next to the marketing copy. */

/* ── 2) Hero ─────────────────────────────────────────────────────────────── */

export const HERO = {
  title: "کتاب صوتی هوشمند، متناسب با هر شنونده",
  /** The line that flips to violet — kept separate so the type can breathe. */
  titleLead: "کتاب صوتی هوشمند،",
  titleAccent: "متناسب با هر شنونده",
  subtitle:
    "پیشنهادهای هوشمند، تجربه شنیداری تعاملی، حالت کودک و انتخاب صدا در یک تجربه یکپارچه.",
  primaryCta: { label: PRIMARY_CTA_LABEL, target: "lead-form" },
  secondaryCta: { label: "مشاهده دمو", target: "demo" },
  highlights: ["شخصی‌سازی‌شده", "مناسب کودک", "چندزبانه", "تعاملی"],
} as const;

/* ── 4) Why Us ───────────────────────────────────────────────────────────── */

export const WHY_US = [
  {
    id: "smart-recommendation",
    icon: "sparkles",
    title: "پیشنهاد هوشمند",
    description: "کتاب‌ها بر اساس سن، سلیقه و رفتار شنیداری پیشنهاد می‌شوند.",
  },
  {
    id: "interactive",
    icon: "message-circle",
    title: "تعامل با محتوا",
    description: "کاربر فقط شنونده نیست و تجربه شنیدن فعال‌تر می‌شود.",
  },
  {
    id: "kids",
    icon: "baby",
    title: "تجربه اختصاصی کودک",
    description: "رابط، صدا و پیشنهادها متناسب با سن کودک تنظیم می‌شوند.",
  },
  {
    id: "localization",
    icon: "globe",
    title: "تنوع زبانی و فرهنگی",
    description: "محتوا متناسب با زبان‌ها و زمینه‌های فرهنگی مختلف ارائه می‌شود.",
  },
] as const;

/* ── 5) Problem ──────────────────────────────────────────────────────────── */

export const PROBLEMS = [
  {
    id: "time",
    icon: "clock",
    title: "زمان کم برای مطالعه",
    description:
      "بخش زیادی از کاربران زمان کافی برای مطالعه مستمر ندارند و مصرف صوتی برایشان طبیعی‌تر است.",
  },
  {
    id: "boring",
    icon: "volume-1",
    title: "تجربه شنیدن یکنواخت",
    description:
      "بسیاری از تجربه‌های موجود تفاوت کمی با یک فایل صوتی ساده دارند و درگیرکنندگی لازم را ایجاد نمی‌کنند.",
  },
  {
    id: "no-personalization",
    icon: "sliders",
    title: "نبود شخصی‌سازی",
    description:
      "کاربر در انتخاب محتوا، سبک روایت و مسیر مصرف، تجربه شخصی‌شده کافی دریافت نمی‌کند.",
  },
  {
    id: "no-interaction",
    icon: "pointer",
    title: "نبود تعامل با محتوا",
    description:
      "کاربر اغلب فقط شنونده منفعل است و محصول رفتار او را در تجربه شنیدن وارد نمی‌کند.",
  },
  {
    id: "kids-gap",
    icon: "book-open",
    title: "کمبود محتوای استاندارد کودک",
    description:
      "پیدا کردن محتوای صوتی مناسب سن، امن و قابل اتکا برای کودک همیشه آسان نیست.",
  },
  {
    id: "culture-gap",
    icon: "languages",
    title: "ضعف در پوشش زبان‌ها و فرهنگ‌های متنوع",
    description:
      "کاربران به محتوایی نزدیک‌تر به زبان، لهجه و فضای فرهنگی خود نیاز دارند.",
  },
] as const;

/* ── 6) Features ─────────────────────────────────────────────────────────── */

export const FEATURES = [
  {
    id: "smart-books",
    icon: "brain",
    title: "پیشنهاد هوشمند کتاب",
    description:
      "سیستم با توجه به رفتار کاربر و علایق او، مسیر شنیدن را هوشمندتر می‌کند.",
    badge: "AI",
  },
  {
    id: "voice-selection",
    icon: "mic",
    title: "انتخاب گوینده",
    description: "کاربر می‌تواند سبک روایت یا صدای دلخواه خود را انتخاب کند.",
  },
  {
    id: "kids-mode",
    icon: "shield",
    title: "حالت کودک",
    description: "ظاهر، پیشنهادها و تجربه استفاده برای کودک ساده‌تر و ایمن‌تر می‌شود.",
  },
  {
    id: "multilingual",
    icon: "languages",
    title: "محتوای چندزبانه",
    description: "کتاب‌ها و محتواها می‌توانند در چند زبان یا با رویکرد بومی عرضه شوند.",
  },
  {
    id: "continue-listening",
    icon: "play-circle",
    title: "ادامه شنیدن",
    description: "کاربر از همان نقطه قبلی، بدون اصطکاک، دوباره شنیدن را شروع می‌کند.",
  },
  {
    id: "library",
    icon: "library",
    title: "کتابخانه شخصی",
    description:
      "فهرست علاقه‌مندی‌ها، آثار ذخیره‌شده و مسیرهای شنیدن کاربر یکجا نگهداری می‌شوند.",
  },
  {
    id: "age-based",
    icon: "user-round",
    title: "متناسب با سن و سلیقه",
    description:
      "پیشنهادها با گروه سنی، نیاز و الگوی مصرف شنیداری کاربر سازگار می‌شوند.",
  },
  {
    id: "interactive",
    icon: "wand",
    title: "تجربه تعاملی",
    description:
      "محصول صرفاً یک پلیر نیست و در نقاطی تجربه شنیدن را هوشمند و درگیرکننده‌تر می‌کند.",
  },
] as const;

/* ── 8) Kids ─────────────────────────────────────────────────────────────── */

export const KIDS = {
  title: "تجربه‌ای اختصاصی برای کودک",
  subtitle:
    "محتوا، صدا، پیشنهادها و رابط کاربری برای گروه سنی کودک به شکل جداگانه طراحی شده‌اند.",
  benefits: [
    {
      id: "safe-ui",
      icon: "layout",
      title: "محیط مناسب سن",
      description:
        "رابط کاربری ساده‌تر، خواناتر و قابل فهم‌تر است و تصمیم‌گیری را برای کودک آسان می‌کند.",
    },
    {
      id: "safe-content",
      icon: "shield-check",
      title: "محتوای امن و کنترل‌شده",
      description:
        "نمایش و پیشنهاد محتوا می‌تواند در مسیر مناسب سن و متناسب با سناریوی کودک محدود شود.",
    },
    {
      id: "voice",
      icon: "mic",
      title: "صدای مناسب کودک",
      description:
        "سبک روایت، تن صدا و مدل ارائه می‌تواند برای شنونده کودک خوش‌فهم‌تر و جذاب‌تر باشد.",
    },
    {
      id: "learning",
      icon: "graduation-cap",
      title: "کمک به یادگیری و عادت شنیدن",
      description:
        "محصول فقط برای سرگرمی نیست و می‌تواند به شکل‌گیری عادت شنیدن، تمرکز و یادگیری کمک کند.",
    },
  ],
  cta: {
    label: PRIMARY_CTA_LABEL,
    presetUserType: "parent",
    presetInterest: "kids",
  },
} as const;

/* ── 11) FAQ ─────────────────────────────────────────────────────────────── */

export const FAQ_ITEMS = [
  {
    id: "q1",
    question: "تفاوت این سرویس با کتاب صوتی معمولی چیست؟",
    answer:
      "این محصول فقط فایل صوتی ارائه نمی‌کند و تجربه شنیدن را با پیشنهاد هوشمند، انتخاب صدا و سناریوهای متناسب با کاربر غنی‌تر می‌کند.",
  },
  {
    id: "q2",
    question: "آیا امکان انتخاب صدا وجود دارد؟",
    answer: "بله، در سناریوهای محصول امکان انتخاب یا تغییر سبک روایت و صدا وجود دارد.",
  },
  {
    id: "q3",
    question: "آیا برای کودک مناسب است؟",
    answer:
      "بله، تجربه‌ای جداگانه برای کودک در نظر گرفته شده که در آن پیشنهادها، رابط و نوع محتوا متناسب‌تر می‌شوند.",
  },
  {
    id: "q4",
    question: "آیا محتوای چندزبانه دارد؟",
    answer: "بله، سرویس می‌تواند از زبان‌ها و سناریوهای محتوایی متنوع پشتیبانی کند.",
  },
  {
    id: "q5",
    question: "آیا تجربه شخصی‌سازی‌شده است؟",
    answer:
      "بله، پیشنهادها و تجربه مصرف می‌توانند بر اساس علایق، سن و الگوی رفتاری کاربر تنظیم شوند.",
  },
  {
    id: "q6",
    question: "آیا اپلیکیشن موبایل هم دارد؟",
    answer: "بسته به برنامه انتشار محصول، نسخه موبایل نیز می‌تواند در دسترس قرار گیرد.",
  },
  {
    id: "q7",
    question: "آیا محتوای بومی هم پشتیبانی می‌شود؟",
    answer:
      "بله، یکی از ارزش‌های مهم محصول پشتیبانی از محتواهای محلی و فرهنگی متنوع است.",
  },
  {
    id: "q8",
    question: "چطور می‌توانم شروع کنم؟",
    answer:
      "کافی است فرم ثبت علاقه‌مندی را تکمیل کنید تا اطلاعات شروع استفاده برای شما ارسال شود.",
  },
] as const;

/* ── 12) Lead Form (static chrome; options come from the API) ────────────── */

export const LEAD_FORM_COPY = {
  eyebrow: "شروع",
  title: "اولین نفری باش که کتاپاد را تجربه می‌کند",
  subtitle:
    "فرم را پر کن تا اطلاعات شروع استفاده، محتوای اختصاصی و دسترسی زودهنگام برایت ارسال شود.",
  consent: "با شرایط و قوانین و حریم خصوصی موافقم.",
  submit: PRIMARY_CTA_LABEL,
  submitting: "در حال ثبت…",
  successTitle: "ثبت شد",
  successBody: "به‌زودی اطلاعات شروع استفاده برایت ارسال می‌شود.",
  duplicateTitle: "قبلاً ثبت شده",
  duplicateBody: "این اطلاعات پیش‌تر ثبت شده است. به‌زودی با تو تماس می‌گیریم.",
  errorTitle: "ثبت نشد",
  errorBody: "مشکلی پیش آمد. لطفاً دوباره تلاش کن.",
} as const;

/* ── 13) Final CTA ───────────────────────────────────────────────────────── */

export const FINAL_CTA = {
  title: "آماده‌ای تجربه جدید کتاب صوتی را شروع کنی؟",
  subtitle: "ثبت‌نام کن و جزو اولین نفراتی باش که این تجربه را امتحان می‌کنند.",
  primaryCta: { label: PRIMARY_CTA_LABEL, target: "lead-form" },
  secondaryCta: { label: "مشاهده دمو", target: "demo" },
} as const;

/* ── 14) Footer ──────────────────────────────────────────────────────────── */

export const FOOTER = {
  brandDescription:
    "پلتفرم هوشمند کتاب صوتی برای تجربه‌ای شخصی‌تر، تعاملی‌تر و نزدیک‌تر به مخاطب.",
  /* Paths come from `lib/routes.ts` so these cannot drift from the pages that
     serve them — which is exactly what had happened: both were 404s linked
     from the footer of all 58 pages. */
  legalLinks: [
    { label: "حریم خصوصی", url: routes.privacy() },
    { label: "قوانین و شرایط", url: routes.terms() },
  ],
  contact: {
    email: "hello@ketapod.ir",
    phone: "+98 21 0000 0000",
  },
  socials: [
    { name: "Instagram", url: "https://instagram.com/ketapod" },
    { name: "LinkedIn", url: "https://linkedin.com/company/ketapod" },
  ],
  copyright: "© ۱۴۰۵ — همه حقوق محفوظ است.",
} as const;
