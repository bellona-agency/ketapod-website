import type {
  Author,
  BlogPost,
  Book,
  Category,
  Collection,
  Dialect,
  Publisher,
  Voice,
} from "./types";

/**
 * Seed catalogue.
 *
 * Same contract as `api.ts`: this is what the pages render when there is no
 * backend, and what they fall back to when one call fails. It is not filler —
 * every page below is built and reviewed against these records, so they carry
 * real copy, real chapter boundaries and real transcript lines rather than lorem
 * ipsum. When the Go core arrives, these become the fixtures its responses are
 * checked against.
 *
 * Durations are in seconds and chapter boundaries are contiguous within each
 * edition, because the book page draws a chapter bar from them and a gap or an
 * overlap shows up immediately as a broken strip.
 */

/* ── Categories ──────────────────────────────────────────────────────────── */

export const CATEGORIES: Category[] = [
  {
    slug: "adabiyat-dastani",
    title: "ادبیات داستانی",
    description:
      "رمان و داستان کوتاه فارسی و ترجمه — از کلاسیک‌های قرن گذشته تا نویسندگان امروز.",
    icon: "book-open",
  },
  {
    slug: "kudak-o-nojavan",
    title: "کودک و نوجوان",
    description:
      "قصه و داستان برای گروه‌های سنی مختلف، با صدای مناسب کودک و کاتالوگ تأییدشده.",
    icon: "baby",
  },
  {
    slug: "modiriyat-o-karafarini",
    title: "مدیریت و کارآفرینی",
    description:
      "کتاب‌های تخصصی کسب‌وکار، مدیریت و کارآفرینی برای شنیدن در مسیر و میان کار.",
    icon: "brain",
  },
  {
    slug: "tarikh-o-andisheh",
    title: "تاریخ و اندیشه",
    description: "تاریخ ایران و جهان، فلسفه و اندیشه اجتماعی در قالب روایت صوتی.",
    icon: "library",
  },
  {
    slug: "ravanshenasi",
    title: "روان‌شناسی",
    description: "شناخت خود و دیگری — از روان‌شناسی عمومی تا رشد فردی و خانواده.",
    icon: "message-circle",
  },
  {
    slug: "sher-o-adab-kohan",
    title: "شعر و ادب کهن",
    description: "دیوان‌ها و متون کهن فارسی با روایت‌هایی که وزن و مکث را نگه می‌دارند.",
    icon: "sparkles",
  },
];

/* ── Dialects ────────────────────────────────────────────────────────────── */

export const DIALECTS: Dialect[] = [
  {
    slug: "gilaki",
    title: "گیلکی",
    region: "گیلان و بخش‌هایی از مازندران و قزوین",
    bcp47: "glk",
    speakerEstimate: "حدود ۳ میلیون گویشور",
    description:
      "گیلکی از زبان‌های ایرانی شمال غربی است و ادبیات شفاهی پرباری دارد که بخش عمده آن هرگز مکتوب نشده. روایت صوتی برای این گویش صرفاً یک قالب دیگر نیست؛ نزدیک‌ترین شکل به همان چیزی است که این ادبیات در آن زیسته است.",
  },
  {
    slug: "kurdi-kurmanji",
    title: "کوردی کرمانجی",
    region: "خراسان شمالی، آذربایجان غربی و کردستان",
    bcp47: "kmr",
    speakerEstimate: "حدود ۲ میلیون گویشور در ایران",
    description:
      "کرمانجی گویش شمالی زبان کردی است و در ایران در دو منطقه جغرافیایی دور از هم زنده مانده. تفاوت آوایی این دو منطقه به‌قدری است که یک ضبط واحد برای هر دو کافی نیست — کاتالوگ کرمانجی کتاپاد این تفاوت را نگه می‌دارد.",
  },
  {
    slug: "azarbaijani",
    title: "ترکی آذربایجانی",
    region: "آذربایجان شرقی و غربی، اردبیل و زنجان",
    bcp47: "azb",
    speakerEstimate: "بیش از ۱۵ میلیون گویشور",
    description:
      "پرگویشورترین زبان ایران پس از فارسی، با سنت داستان‌گویی و عاشیقی که ذاتاً صوتی است. بخش بزرگی از این میراث تاکنون فقط در اجرای زنده وجود داشته است.",
  },
  {
    slug: "luri",
    title: "لری",
    region: "لرستان، چهارمحال و بختیاری، کهگیلویه و بویراحمد",
    bcp47: "lrc",
    speakerEstimate: "حدود ۵ میلیون گویشور",
    description:
      "لری طیفی از گویش‌های به‌هم‌پیوسته است، نه یک زبان یکدست. کاتالوگ لری با تفکیک لری مرکزی و بختیاری ساخته می‌شود، چون شنونده تفاوت را در جمله اول تشخیص می‌دهد.",
  },
  {
    slug: "balochi",
    title: "بلوچی",
    region: "سیستان و بلوچستان و جنوب کرمان",
    bcp47: "bal",
    speakerEstimate: "حدود ۲ میلیون گویشور در ایران",
    description:
      "بلوچی از زبان‌های ایرانی شمال غربی با ادبیات شفاهی حماسی گسترده. کمترین محتوای صوتی منتشرشده را در میان زبان‌های ایرانی دارد و همین آن را به یکی از اولویت‌های کاتالوگ تبدیل می‌کند.",
  },
];

/* ── Authors ─────────────────────────────────────────────────────────────── */

export const AUTHORS: Author[] = [
  {
    slug: "sadegh-hedayat",
    name: "صادق هدایت",
    nameLatin: "Sadegh Hedayat",
    birthYear: 1281,
    deathYear: 1330,
    bio: "نویسنده، مترجم و پژوهشگر فرهنگ عامه؛ بنیان‌گذار داستان‌نویسی مدرن فارسی. آثارش میان روایت روان‌شناختی، طنز تلخ اجتماعی و پژوهش فولکلور در نوسان است.",
  },
  {
    slug: "simin-daneshvar",
    name: "سیمین دانشور",
    nameLatin: "Simin Daneshvar",
    birthYear: 1300,
    deathYear: 1390,
    bio: "نخستین زن ایرانی که رمان منتشر کرد و از تأثیرگذارترین صداهای ادبیات معاصر فارسی. نثر او روایت تاریخی را از منظر زندگی روزمره می‌سازد.",
  },
  {
    slug: "mahmoud-dowlatabadi",
    name: "محمود دولت‌آبادی",
    nameLatin: "Mahmoud Dowlatabadi",
    birthYear: 1319,
    bio: "رمان‌نویس و نمایش‌نامه‌نویس؛ شناخته‌شده برای روایت بلند زندگی روستایی خراسان و نثری که آهنگ گفتار شفاهی را نگه می‌دارد — نثری که برای شنیدن ساخته شده است.",
  },
  {
    slug: "houshang-moradi-kermani",
    name: "هوشنگ مرادی کرمانی",
    nameLatin: "Houshang Moradi Kermani",
    birthYear: 1323,
    bio: "نویسنده ادبیات کودک و نوجوان و برنده جایزه هانس کریستین اندرسن. قصه‌هایش از دل تجربه زیسته کودکی در روستا بیرون آمده‌اند و لحن شفاهی‌شان آن‌ها را به متن ایده‌آل روایت صوتی تبدیل می‌کند.",
  },
  {
    slug: "samad-behrangi",
    name: "صمد بهرنگی",
    nameLatin: "Samad Behrangi",
    birthYear: 1318,
    deathYear: 1347,
    bio: "معلم، مترجم و نویسنده ادبیات کودک؛ گردآورنده افسانه‌های آذربایجان و نویسنده قصه‌هایی که زبان ساده کودکانه را با پرسش اجتماعی جدی ترکیب می‌کنند.",
  },
  {
    slug: "iraj-pezeshkzad",
    name: "ایرج پزشک‌زاد",
    nameLatin: "Iraj Pezeshkzad",
    birthYear: 1306,
    deathYear: 1400,
    bio: "نویسنده و طنزپرداز؛ خالق یکی از ماندگارترین رمان‌های طنز فارسی. دیالوگ‌محوری آثارش باعث می‌شود اجرای صوتی چندصدایی برایشان طبیعی‌تر از خواندن باشد.",
  },
  {
    slug: "antoine-de-saint-exupery",
    name: "آنتوان دو سنت‌اگزوپری",
    nameLatin: "Antoine de Saint-Exupéry",
    birthYear: 1279,
    deathYear: 1323,
    bio: "خلبان و نویسنده فرانسوی. مشهورترین اثرش، که در ظاهر برای کودکان نوشته شده، یکی از پرترجمه‌ترین کتاب‌های تاریخ است.",
  },
];

/* ── Publishers ──────────────────────────────────────────────────────────── */

export const PUBLISHERS: Publisher[] = [
  {
    slug: "nashr-cheshmeh",
    name: "نشر چشمه",
    foundedYear: 1364,
    bio: "از فعال‌ترین ناشران ادبیات داستانی معاصر فارسی و ترجمه ادبی.",
  },
  {
    slug: "amirkabir",
    name: "انتشارات امیرکبیر",
    foundedYear: 1328,
    bio: "یکی از قدیمی‌ترین ناشران ایران با کارنامه‌ای گسترده در ادبیات، تاریخ و مرجع.",
  },
  {
    slug: "nashr-ney",
    name: "نشر نی",
    foundedYear: 1364,
    bio: "ناشر علوم انسانی، اندیشه اجتماعی و اقتصاد؛ شناخته‌شده برای ترجمه‌های دقیق.",
  },
  {
    slug: "kanoon",
    name: "کانون پرورش فکری کودکان و نوجوانان",
    foundedYear: 1344,
    bio: "نهاد تولید و نشر محتوای کودک و نوجوان با سابقه‌ای طولانی در کتاب گویا.",
  },
];

/* ── Voices ──────────────────────────────────────────────────────────────—
   `id` here is the left half of the spec's `voices[].id == sources[].voiceId`
   contract; `AudioEdition.voiceId` is the right half. Nothing else may point
   at a voice.                                                                */

export const VOICES: Voice[] = [
  {
    id: "vo_parvaneh",
    slug: "parvaneh-rahimi",
    name: "پروانه رحیمی",
    type: "human",
    timbre: "روایت گرم و آرام",
    kidsApproved: true,
    bio: "گوینده رادیو با بیش از پانزده سال سابقه روایت ادبی. لحن او در متن‌های اول‌شخص و روایت‌های درونی شناخته می‌شود.",
  },
  {
    id: "vo_kaveh",
    slug: "kaveh-ansari",
    name: "کاوه انصاری",
    type: "human",
    timbre: "صدای بم، روایت جدی",
    kidsApproved: false,
    bio: "بازیگر تئاتر و گوینده؛ اجرای او برای متون تاریخی و رمان‌های بلند انتخاب می‌شود، جایی که شنونده ساعت‌ها با یک صدا می‌ماند.",
  },
  {
    id: "vo_shirin",
    slug: "shirin-tabatabai",
    name: "شیرین طباطبایی",
    type: "human",
    timbre: "قصه‌گوی کودک",
    kidsApproved: true,
    bio: "قصه‌گو و مربی کودک. اجراهایش برای گروه سنی زیر ده سال ساخته می‌شوند: جمله‌های کوتاه‌تر، مکث‌های بلندتر و دامنه صوتی محدودتر.",
  },
  {
    id: "vo_rasht",
    slug: "hooman-gilani",
    name: "هومن گیلانی",
    type: "human",
    timbre: "روایت گیلکی",
    dialectSlug: "gilaki",
    kidsApproved: true,
    bio: "گوینده و پژوهشگر ادبیات شفاهی گیلان. اجرای او مرجع تلفظ گیلکی در واژه‌نامه تلفظ کتاپاد است.",
  },
  {
    id: "vo_sahar",
    slug: "sahar-tabrizi",
    name: "سحر تبریزی",
    type: "human",
    timbre: "روایت ترکی آذربایجانی",
    dialectSlug: "azarbaijani",
    kidsApproved: true,
    bio: "گوینده دوزبانه؛ اجرای آذربایجانی و فارسی. کار او روی افسانه‌های آذربایجان پایه کاتالوگ ترکی است.",
  },
  {
    id: "vo_neutral",
    slug: "nava-neutral",
    name: "نوا",
    type: "ai",
    timbre: "روایت خنثی و یکدست",
    kidsApproved: false,
    bio: "مدل گفتار فارسی کتاپاد. برای متون بلند غیرداستانی ساخته شده، جایی که یکدستی مهم‌تر از بازیگری است.",
  },
  {
    id: "vo_nava_kids",
    slug: "nava-kids",
    name: "نوا — کودک",
    type: "ai",
    timbre: "روایت روشن و کند",
    kidsApproved: true,
    bio: "نسخه تنظیم‌شده مدل نوا برای شنونده کودک: سرعت پایین‌تر، دامنه زیر و بمی محدودتر و مکث بلندتر میان جمله‌ها.",
  },
  {
    id: "vo_bakhtiari",
    slug: "iman-bakhtiari",
    name: "ایمان بختیاری",
    type: "human",
    timbre: "روایت لری بختیاری",
    dialectSlug: "luri",
    kidsApproved: false,
    bio: "گوینده و موسیقی‌دان؛ اجرای او آهنگ کلام بختیاری را در روایت نثر نگه می‌دارد.",
  },
];

/* ── Books ───────────────────────────────────────────────────────────────── */

export const BOOKS: Book[] = [
  {
    slug: "boof-e-koor",
    title: "بوف کور",
    authorSlug: "sadegh-hedayat",
    publisherSlug: "amirkabir",
    categorySlugs: ["adabiyat-dastani"],
    publishedYear: 1315,
    language: "fa",
    isbn: "978-964-00-0001-1",
    description:
      "روایت اول‌شخص مردی که نقاشی روی جلد قلمدان می‌کند و در تب و انزوا، تصویری تکرارشونده را بارها از نو می‌سازد. متن میان خواب و بیداری حرکت می‌کند و همان جمله‌ها در بافت تازه معنای دیگری می‌گیرند. تأثیرگذارترین رمان کوتاه فارسی قرن گذشته و نقطه شروع داستان‌نویسی مدرن ایران.",
    summary:
      "راوی، نقاشی منزوی، تصویری را که بارها کشیده در واقعیت می‌بیند و از آن پس مرز میان آنچه رخ داده و آنچه تصور شده در روایت او فرو می‌ریزد. متن در دو بخش آینه‌وار ساخته شده: شخصیت‌ها و اشیای بخش اول در بخش دوم با نام و نسبت دیگری بازمی‌گردند.",
    reviews: [
      {
        id: "rv-bk-1",
        author: "مهسا ر.",
        rating: 5,
        date: "2025-11-14",
        body: "این کتاب را دو بار خوانده بودم و هر بار نیمه‌کاره رها کرده بودم. با روایت کاوه انصاری تا آخر رفتم — مکث‌هایی که در متن می‌بینی ولی رد می‌شوی، اینجا شنیده می‌شوند.",
      },
      {
        id: "rv-bk-2",
        author: "امیر ک.",
        rating: 4,
        date: "2025-12-02",
        body: "اجرا عالی است. فقط برای متنی به این تودرتویی کاش فهرست فصل‌ها دقیق‌تر بود تا بشود به بخش دوم برگشت.",
      },
    ],
    editions: [
      {
        id: "ed_boof_kaveh",
        voiceId: "vo_kaveh",
        narratorType: "human",
        priceRial: 890000,
        durationSec: 15420,
        isKidsFriendly: false,
        chapters: [
          { index: 1, title: "زخم‌هایی که روح را می‌خورد", startSec: 0, endSec: 3180 },
          { index: 2, title: "پیرمرد خنزرپنزری", startSec: 3180, endSec: 6900 },
          { index: 3, title: "قلمدان", startSec: 6900, endSec: 10380 },
          { index: 4, title: "لکاته", startSec: 10380, endSec: 13260 },
          { index: 5, title: "بازگشت تصویر", startSec: 13260, endSec: 15420 },
        ],
        transcriptSample: [
          {
            startSec: 0,
            endSec: 8.4,
            text: "در زندگی زخم‌هایی هست که مثل خوره روح را آهسته در انزوا می‌خورد و می‌تراشد.",
          },
          {
            startSec: 8.4,
            endSec: 15.2,
            text: "این دردها را نمی‌شود به کسی اظهار کرد، چون عموماً عادت دارند که این دردهای باورنکردنی را جزو اتفاقات و پیش‌آمدهای نادر و عجیب بشمارند.",
          },
          {
            startSec: 15.2,
            endSec: 21.6,
            text: "و اگر کسی بگوید یا بنویسد، مردم بر سبیل عقاید جاری و عقاید خودشان سعی می‌کنند آن را با لبخند شکاک و تمسخرآمیز تلقی بکنند.",
          },
        ],
      },
      {
        id: "ed_boof_ai",
        voiceId: "vo_neutral",
        narratorType: "ai",
        priceRial: 0,
        durationSec: 14760,
        isKidsFriendly: false,
        chapters: [
          { index: 1, title: "زخم‌هایی که روح را می‌خورد", startSec: 0, endSec: 3040 },
          { index: 2, title: "پیرمرد خنزرپنزری", startSec: 3040, endSec: 6600 },
          { index: 3, title: "قلمدان", startSec: 6600, endSec: 9930 },
          { index: 4, title: "لکاته", startSec: 9930, endSec: 12690 },
          { index: 5, title: "بازگشت تصویر", startSec: 12690, endSec: 14760 },
        ],
        transcriptSample: [
          {
            startSec: 0,
            endSec: 8.1,
            text: "در زندگی زخم‌هایی هست که مثل خوره روح را آهسته در انزوا می‌خورد و می‌تراشد.",
          },
          {
            startSec: 8.1,
            endSec: 14.7,
            text: "این دردها را نمی‌شود به کسی اظهار کرد، چون عموماً عادت دارند که این دردهای باورنکردنی را جزو اتفاقات و پیش‌آمدهای نادر و عجیب بشمارند.",
          },
        ],
      },
    ],
  },
  {
    slug: "savushun",
    title: "سووشون",
    authorSlug: "simin-daneshvar",
    publisherSlug: "nashr-cheshmeh",
    categorySlugs: ["adabiyat-dastani", "tarikh-o-andisheh"],
    publishedYear: 1348,
    language: "fa",
    isbn: "978-964-00-0002-8",
    description:
      "شیراز، سال‌های اشغال ایران در جنگ جهانی دوم. زری، زن خانواده‌ای زمین‌دار، میان محافظت از خانه و ایستادگی همسرش یوسف گیر افتاده است. رمان تاریخ را از آشپزخانه و اتاق نشیمن روایت می‌کند، نه از میدان — و همین آن را به یکی از دقیق‌ترین تصویرهای آن دوره تبدیل کرده است.",
    summary:
      "زری می‌کوشد خانواده‌اش را از درگیری دور نگه دارد، در حالی که یوسف از فروش غله به نیروهای اشغالگر سر باز می‌زند. عنوان رمان از آیین سوگ سیاوش گرفته شده و ساختار کتاب همان الگو را دنبال می‌کند: مرگی که به جای پایان، آغاز یک آگاهی جمعی است.",
    reviews: [
      {
        id: "rv-sv-1",
        author: "نگین ف.",
        rating: 5,
        date: "2025-10-21",
        body: "روایت پروانه رحیمی دقیقاً همان لحن زری است. جاهایی که باید آرام و مردد باشد، هست.",
      },
    ],
    editions: [
      {
        id: "ed_savushun_parvaneh",
        voiceId: "vo_parvaneh",
        narratorType: "human",
        priceRial: 1150000,
        durationSec: 39600,
        isKidsFriendly: false,
        chapters: [
          { index: 1, title: "عروسی", startSec: 0, endSec: 5400 },
          { index: 2, title: "خانه یوسف", startSec: 5400, endSec: 11700 },
          { index: 3, title: "غله", startSec: 11700, endSec: 18900 },
          { index: 4, title: "بیمارستان", startSec: 18900, endSec: 26100 },
          { index: 5, title: "قحطی", startSec: 26100, endSec: 33300 },
          { index: 6, title: "سووشون", startSec: 33300, endSec: 39600 },
        ],
        transcriptSample: [
          {
            startSec: 0,
            endSec: 7.8,
            text: "عروسی دختر حاکم بود و شهر چراغانی شده بود.",
          },
          {
            startSec: 7.8,
            endSec: 16.4,
            text: "زری در آینه نگاه کرد و گوشواره‌هایش را که یوسف روز اول برایش خریده بود، برداشت.",
          },
        ],
      },
    ],
  },
  {
    slug: "ja-ye-khali-e-soluch",
    title: "جای خالی سلوچ",
    authorSlug: "mahmoud-dowlatabadi",
    publisherSlug: "nashr-cheshmeh",
    categorySlugs: ["adabiyat-dastani"],
    publishedYear: 1358,
    language: "fa",
    description:
      "سلوچ یک روز صبح از خانه بیرون می‌رود و برنمی‌گردد. مرگان و سه فرزندش در روستایی خشک در خراسان می‌مانند و باید بفهمند بدون او چطور زنده بمانند. دولت‌آبادی رمان را به نثری نوشته که آهنگ گفتار روستایی را نگه می‌دارد؛ متنی که خواندنش سخت‌تر از شنیدنش است.",
    summary:
      "غیبت سلوچ خانواده را وارد اقتصادی می‌کند که برای آن ساخته نشده‌اند: زمین بی‌آب، وام، و ورود ماشین به روستا. مرگان از موضع منتظر به موضع تصمیم‌گیرنده می‌رسد و رمان همین انتقال را دنبال می‌کند.",
    reviews: [
      {
        id: "rv-js-1",
        author: "رضا م.",
        rating: 5,
        date: "2025-09-30",
        body: "نثر دولت‌آبادی روی کاغذ برایم سنگین بود. با صدا انگار کسی دارد برایت تعریف می‌کند و همه‌چیز جا می‌افتد.",
      },
    ],
    editions: [
      {
        id: "ed_soluch_kaveh",
        voiceId: "vo_kaveh",
        narratorType: "human",
        priceRial: 1290000,
        durationSec: 54000,
        isKidsFriendly: false,
        chapters: [
          { index: 1, title: "صبحی که سلوچ نبود", startSec: 0, endSec: 7200 },
          { index: 2, title: "مرگان", startSec: 7200, endSec: 16200 },
          { index: 3, title: "زمین بی‌آب", startSec: 16200, endSec: 25200 },
          { index: 4, title: "عباس", startSec: 25200, endSec: 34200 },
          { index: 5, title: "هاجر", startSec: 34200, endSec: 45000 },
          { index: 6, title: "تراکتور", startSec: 45000, endSec: 54000 },
        ],
        transcriptSample: [
          {
            startSec: 0,
            endSec: 9.2,
            text: "مرگان که چشم باز کرد، جای سلوچ خالی بود.",
          },
          {
            startSec: 9.2,
            endSec: 18.6,
            text: "نه صدایی، نه رد پایی، نه نشانی. انگار که هرگز در آن خانه نفس نکشیده باشد.",
          },
        ],
      },
      {
        id: "ed_soluch_bakhtiari",
        voiceId: "vo_bakhtiari",
        narratorType: "human",
        dialectSlug: "luri",
        priceRial: 1290000,
        durationSec: 55800,
        isKidsFriendly: false,
        chapters: [
          { index: 1, title: "صبحی که سلوچ نبود", startSec: 0, endSec: 7440 },
          { index: 2, title: "مرگان", startSec: 7440, endSec: 16740 },
          { index: 3, title: "زمین بی‌آب", startSec: 16740, endSec: 26040 },
          { index: 4, title: "عباس", startSec: 26040, endSec: 35340 },
          { index: 5, title: "هاجر", startSec: 35340, endSec: 46500 },
          { index: 6, title: "تراکتور", startSec: 46500, endSec: 55800 },
        ],
        transcriptSample: [
          {
            startSec: 0,
            endSec: 9.6,
            text: "مرگان که چشم باز کرد، جای سلوچ خالی بود.",
          },
        ],
      },
    ],
  },
  {
    slug: "daei-jan-napoleon",
    title: "دایی جان ناپلئون",
    authorSlug: "iraj-pezeshkzad",
    publisherSlug: "nashr-cheshmeh",
    categorySlugs: ["adabiyat-dastani"],
    publishedYear: 1349,
    language: "fa",
    description:
      "در باغی بزرگ در تهران دهه بیست، خانواده‌ای پرجمعیت زیر سایه مردی زندگی می‌کند که مطمئن است انگلیسی‌ها پشت هر اتفاقی هستند. راوی نوجوان عاشق دخترخاله‌اش شده و همین عشق ساده وارد ماشین توطئه‌بافی دایی جان می‌شود. ماندگارترین رمان طنز فارسی.",
    summary:
      "روایت از زبان پسری نوجوان است که عشقش به لیلی مدام گروگان سوءتفاهم‌های خانوادگی می‌شود. دایی جان هر رویداد را به دسیسه انگلیسی‌ها نسبت می‌دهد و مش قاسم هر ادعا را با «چرا دروغ، تا قبر آ آ آ» تأیید می‌کند.",
    reviews: [
      {
        id: "rv-dj-1",
        author: "سپیده ن.",
        rating: 5,
        date: "2026-01-08",
        body: "دیالوگ‌محور بودن کتاب باعث شده اجرای صوتی از خواندنش بامزه‌تر باشد. بلند خندیدم در مترو.",
      },
      {
        id: "rv-dj-2",
        author: "حامد ط.",
        rating: 5,
        date: "2025-12-19",
        body: "مش قاسم با این صدا دقیقاً همانی است که در ذهنم بود.",
      },
    ],
    editions: [
      {
        id: "ed_napoleon_kaveh",
        voiceId: "vo_kaveh",
        narratorType: "human",
        priceRial: 1390000,
        durationSec: 61200,
        isKidsFriendly: false,
        chapters: [
          { index: 1, title: "یک بعدازظهر تابستان", startSec: 0, endSec: 8100 },
          { index: 2, title: "دایی جان و مش قاسم", startSec: 8100, endSec: 18000 },
          { index: 3, title: "نامه", startSec: 18000, endSec: 28800 },
          { index: 4, title: "دکتر ناصرالحکما", startSec: 28800, endSec: 40500 },
          { index: 5, title: "اسدالله میرزا", startSec: 40500, endSec: 51300 },
          { index: 6, title: "سن‌لویی", startSec: 51300, endSec: 61200 },
        ],
        transcriptSample: [
          {
            startSec: 0,
            endSec: 10.4,
            text: "من یک روز گرم تابستان، دقیقاً ساعت سه و ربع کم بعدازظهر روز سیزدهم مرداد، عاشق شدم.",
          },
        ],
      },
    ],
  },
  {
    slug: "ghesse-haye-majid",
    title: "قصه‌های مجید",
    authorSlug: "houshang-moradi-kermani",
    publisherSlug: "kanoon",
    categorySlugs: ["kudak-o-nojavan", "adabiyat-dastani"],
    publishedYear: 1358,
    language: "fa",
    description:
      "مجید با بی‌بی، مادربزرگش، در کرمان زندگی می‌کند. هر قصه یک ماجرای کوچک است — یک انشا، یک دوچرخه قرضی، یک مهمان ناخوانده — که با شیطنت شروع می‌شود و با درسی که کسی مستقیم نگفته تمام می‌شود. لحن شفاهی این قصه‌ها آن‌ها را برای شنیدن ساخته است.",
    summary:
      "مجموعه‌ای از داستان‌های کوتاه مستقل با دو شخصیت ثابت. هیچ قصه‌ای به قصه دیگر وابسته نیست، بنابراین می‌شود از هر جا شروع کرد — که برای شنونده کودک، ویژگی مهمی است.",
    reviews: [
      {
        id: "rv-gm-1",
        author: "والد — لیلا ص.",
        rating: 5,
        date: "2026-02-02",
        body: "قصه شب دخترم شده. هر شب یکی. دقیقاً همان کاری که تایمر خواب باید بکند.",
      },
    ],
    editions: [
      {
        id: "ed_majid_shirin",
        voiceId: "vo_shirin",
        narratorType: "human",
        priceRial: 690000,
        durationSec: 21600,
        isKidsFriendly: true,
        chapters: [
          { index: 1, title: "انشا", startSec: 0, endSec: 2700 },
          { index: 2, title: "دوچرخه", startSec: 2700, endSec: 5940 },
          { index: 3, title: "سماور", startSec: 5940, endSec: 9180 },
          { index: 4, title: "کفش‌های نو", startSec: 9180, endSec: 12960 },
          { index: 5, title: "مهمان", startSec: 12960, endSec: 17280 },
          { index: 6, title: "عکس یادگاری", startSec: 17280, endSec: 21600 },
        ],
        transcriptSample: [
          {
            startSec: 0,
            endSec: 7.2,
            text: "معلم انشا گفت: بچه‌ها، موضوع انشای این هفته این است — علم بهتر است یا ثروت؟",
          },
          {
            startSec: 7.2,
            endSec: 14.8,
            text: "من که تا آن روز نه علم داشتم نه ثروت، ماندم چه بنویسم.",
          },
        ],
      },
      {
        id: "ed_majid_kids_ai",
        voiceId: "vo_nava_kids",
        narratorType: "ai",
        priceRial: 0,
        durationSec: 23400,
        isKidsFriendly: true,
        chapters: [
          { index: 1, title: "انشا", startSec: 0, endSec: 2925 },
          { index: 2, title: "دوچرخه", startSec: 2925, endSec: 6435 },
          { index: 3, title: "سماور", startSec: 6435, endSec: 9945 },
          { index: 4, title: "کفش‌های نو", startSec: 9945, endSec: 14040 },
          { index: 5, title: "مهمان", startSec: 14040, endSec: 18720 },
          { index: 6, title: "عکس یادگاری", startSec: 18720, endSec: 23400 },
        ],
        transcriptSample: [
          {
            startSec: 0,
            endSec: 7.8,
            text: "معلم انشا گفت: بچه‌ها، موضوع انشای این هفته این است — علم بهتر است یا ثروت؟",
          },
        ],
      },
    ],
  },
  {
    slug: "mahi-siah-koochooloo",
    title: "ماهی سیاه کوچولو",
    authorSlug: "samad-behrangi",
    publisherSlug: "kanoon",
    categorySlugs: ["kudak-o-nojavan"],
    publishedYear: 1347,
    language: "fa",
    description:
      "ماهی کوچکی که می‌خواهد بداند جویبار به کجا می‌رسد، برخلاف نصیحت همه راه می‌افتد. در مسیر با مارمولک، پرنده ماهی‌خوار و دریا روبه‌رو می‌شود. قصه‌ای کوتاه که چند نسل آن را در دو سطح خوانده‌اند: ماجرای یک ماهی، و چیزی بیشتر.",
    summary:
      "ماهی سیاه کوچولو از مادرش و از جامعه ماهی‌های جویبار جدا می‌شود تا انتهای مسیر آب را ببیند. هر برخورد در راه یک درس عملی است، و پایان قصه عمداً باز گذاشته شده است.",
    reviews: [
      {
        id: "rv-ms-1",
        author: "والد — کاوه ب.",
        rating: 5,
        date: "2026-01-25",
        body: "برای پسر هفت‌ساله‌ام گذاشتم و بعدش کلی سؤال پرسید. دقیقاً همان چیزی که از یک قصه می‌خواهم.",
      },
    ],
    editions: [
      {
        id: "ed_mahi_shirin",
        voiceId: "vo_shirin",
        narratorType: "human",
        priceRial: 0,
        durationSec: 2760,
        isKidsFriendly: true,
        chapters: [
          { index: 1, title: "شب چله در ته دریا", startSec: 0, endSec: 480 },
          { index: 2, title: "راه افتادن", startSec: 480, endSec: 1140 },
          { index: 3, title: "مارمولک و خنجر", startSec: 1140, endSec: 1800 },
          { index: 4, title: "ماهی‌خوار", startSec: 1800, endSec: 2280 },
          { index: 5, title: "دریا", startSec: 2280, endSec: 2760 },
        ],
        transcriptSample: [
          {
            startSec: 0,
            endSec: 8.6,
            text: "شب چله بود. ته دریا، ماهی پیر دوازده هزار تا از بچه‌ها و نوه‌هایش را دور خودش جمع کرده بود و برایشان قصه می‌گفت.",
          },
          {
            startSec: 8.6,
            endSec: 15.4,
            text: "یکی بود یکی نبود. یک ماهی سیاه کوچولو بود که با مادرش در جویباری زندگی می‌کرد.",
          },
        ],
      },
      {
        id: "ed_mahi_gilaki",
        voiceId: "vo_rasht",
        narratorType: "human",
        dialectSlug: "gilaki",
        priceRial: 0,
        durationSec: 2940,
        isKidsFriendly: true,
        chapters: [
          { index: 1, title: "شب چله در ته دریا", startSec: 0, endSec: 510 },
          { index: 2, title: "راه افتادن", startSec: 510, endSec: 1215 },
          { index: 3, title: "مارمولک و خنجر", startSec: 1215, endSec: 1920 },
          { index: 4, title: "ماهی‌خوار", startSec: 1920, endSec: 2430 },
          { index: 5, title: "دریا", startSec: 2430, endSec: 2940 },
        ],
        transcriptSample: [
          {
            startSec: 0,
            endSec: 9.1,
            text: "شب چله بود. ته دریا، ماهی پیر دوازده هزار تا از بچه‌ها و نوه‌هایش را دور خودش جمع کرده بود.",
          },
        ],
      },
      {
        id: "ed_mahi_azari",
        voiceId: "vo_sahar",
        narratorType: "human",
        dialectSlug: "azarbaijani",
        priceRial: 0,
        durationSec: 2880,
        isKidsFriendly: true,
        chapters: [
          { index: 1, title: "شب چله در ته دریا", startSec: 0, endSec: 500 },
          { index: 2, title: "راه افتادن", startSec: 500, endSec: 1190 },
          { index: 3, title: "مارمولک و خنجر", startSec: 1190, endSec: 1880 },
          { index: 4, title: "ماهی‌خوار", startSec: 1880, endSec: 2380 },
          { index: 5, title: "دریا", startSec: 2380, endSec: 2880 },
        ],
        transcriptSample: [
          {
            startSec: 0,
            endSec: 8.9,
            text: "شب چله بود. ته دریا، ماهی پیر بچه‌ها و نوه‌هایش را دور خودش جمع کرده بود و برایشان قصه می‌گفت.",
          },
        ],
      },
    ],
  },
  {
    slug: "shazde-koochooloo",
    title: "شازده کوچولو",
    originalTitle: "Le Petit Prince",
    authorSlug: "antoine-de-saint-exupery",
    translator: "احمد شاملو",
    publisherSlug: "amirkabir",
    categorySlugs: ["kudak-o-nojavan", "adabiyat-dastani"],
    publishedYear: 1322,
    language: "fa",
    description:
      "خلبانی در صحرا فرود اضطراری می‌کند و پسرکی را می‌بیند که از سیارکی کوچک آمده است. شازده کوچولو از سفرش میان سیاره‌ها می‌گوید و از گلی که پشت سر گذاشته. کتابی که در ظاهر برای کودکان نوشته شده و بزرگسالان بیشتر از آن حرف می‌زنند.",
    summary:
      "روایت در دو زمان جریان دارد: حال، در صحرا کنار هواپیمای خراب؛ و گذشته، در سفر شازده کوچولو به هفت سیاره که هر کدام یک شخصیت بزرگسال تک‌بعدی دارند. فصل روباه، که در آن مفهوم «اهلی کردن» ساخته می‌شود، مرکز فکری کتاب است.",
    reviews: [
      {
        id: "rv-sk-1",
        author: "آرش د.",
        rating: 5,
        date: "2025-11-29",
        body: "ترجمه شاملو با صدای پروانه رحیمی — همان کتابی که بچگی خوانده بودم ولی این‌بار جمله‌ها را واقعاً شنیدم.",
      },
    ],
    editions: [
      {
        id: "ed_shazde_parvaneh",
        voiceId: "vo_parvaneh",
        narratorType: "human",
        priceRial: 590000,
        durationSec: 9000,
        isKidsFriendly: true,
        chapters: [
          { index: 1, title: "کلاه یا مار بوآ", startSec: 0, endSec: 1200 },
          { index: 2, title: "بره‌ای بکش", startSec: 1200, endSec: 2400 },
          { index: 3, title: "گل", startSec: 2400, endSec: 3900 },
          { index: 4, title: "هفت سیاره", startSec: 3900, endSec: 6000 },
          { index: 5, title: "روباه", startSec: 6000, endSec: 7500 },
          { index: 6, title: "چاه", startSec: 7500, endSec: 9000 },
        ],
        transcriptSample: [
          {
            startSec: 0,
            endSec: 9.4,
            text: "آدم‌بزرگ‌ها هیچ‌وقت خودشان به‌تنهایی چیزی نمی‌فهمند و برای بچه‌ها هم خسته‌کننده است که همیشه و همیشه به آن‌ها توضیح بدهند.",
          },
          {
            startSec: 9.4,
            endSec: 16.2,
            text: "آدم فقط با دل خودش خوب می‌بیند. اصل چیزها از چشم پنهان است.",
          },
        ],
      },
      {
        id: "ed_shazde_kids_ai",
        voiceId: "vo_nava_kids",
        narratorType: "ai",
        priceRial: 0,
        durationSec: 9720,
        isKidsFriendly: true,
        chapters: [
          { index: 1, title: "کلاه یا مار بوآ", startSec: 0, endSec: 1296 },
          { index: 2, title: "بره‌ای بکش", startSec: 1296, endSec: 2592 },
          { index: 3, title: "گل", startSec: 2592, endSec: 4212 },
          { index: 4, title: "هفت سیاره", startSec: 4212, endSec: 6480 },
          { index: 5, title: "روباه", startSec: 6480, endSec: 8100 },
          { index: 6, title: "چاه", startSec: 8100, endSec: 9720 },
        ],
        transcriptSample: [
          {
            startSec: 0,
            endSec: 10.1,
            text: "آدم فقط با دل خودش خوب می‌بیند. اصل چیزها از چشم پنهان است.",
          },
        ],
      },
    ],
  },
  {
    slug: "sazman-e-yadgirande",
    title: "سازمانی که یاد می‌گیرد",
    authorSlug: "mahmoud-dowlatabadi",
    publisherSlug: "nashr-ney",
    categorySlugs: ["modiriyat-o-karafarini"],
    publishedYear: 1399,
    language: "fa",
    description:
      "چرا سازمان‌هایی که آدم‌های باهوش دارند تصمیم‌های احمقانه می‌گیرند؟ این کتاب پاسخ را در ساختار جست‌وجو می‌کند نه در افراد: در حلقه‌های بازخوردی که کسی نمی‌بیند، در تأخیر میان علت و معلول، و در پاداش‌هایی که رفتار اشتباه را تقویت می‌کنند.",
    summary:
      "پنج فصل، هر کدام یک الگوی تکرارشونده شکست سازمانی را با مثال ایرانی توضیح می‌دهد. فصل سوم — تأخیر در بازخورد — پرارجاع‌ترین بخش کتاب است.",
    reviews: [
      {
        id: "rv-sy-1",
        author: "پویا الف.",
        rating: 4,
        date: "2026-01-12",
        body: "برای شنیدن در مسیر کار عالی است. فصل‌بندی دقیق باعث می‌شود بشود یک فصل در روز جلو رفت.",
      },
    ],
    editions: [
      {
        id: "ed_sazman_ai",
        voiceId: "vo_neutral",
        narratorType: "ai",
        priceRial: 450000,
        durationSec: 25200,
        isKidsFriendly: false,
        chapters: [
          { index: 1, title: "مسئله در ساختار است", startSec: 0, endSec: 4320 },
          { index: 2, title: "حلقه‌های بازخورد", startSec: 4320, endSec: 9360 },
          { index: 3, title: "تأخیر", startSec: 9360, endSec: 15120 },
          { index: 4, title: "پاداش اشتباه", startSec: 15120, endSec: 20160 },
          { index: 5, title: "سازمان یادگیرنده", startSec: 20160, endSec: 25200 },
        ],
        transcriptSample: [
          {
            startSec: 0,
            endSec: 9.8,
            text: "وقتی نتیجه یک تصمیم شش ماه بعد ظاهر می‌شود، هیچ‌کس آن نتیجه را به آن تصمیم وصل نمی‌کند.",
          },
        ],
      },
    ],
  },
  {
    slug: "asatir-e-gilan",
    title: "افسانه‌های گیلان",
    authorSlug: "samad-behrangi",
    publisherSlug: "kanoon",
    categorySlugs: ["kudak-o-nojavan", "tarikh-o-andisheh"],
    publishedYear: 1345,
    language: "fa",
    description:
      "چهارده افسانه شفاهی گیلان که تا پیش از این تنها در اجرای زنده و در خانه‌های روستایی منتقل می‌شدند. هر افسانه در دو نسخه ضبط شده است — گیلکی و فارسی — و این نخستین باری است که هر دو کنار هم منتشر می‌شوند.",
    summary:
      "افسانه‌ها بر اساس منطقه گردآوری شده‌اند نه موضوع، چون تفاوت روایت یک قصه واحد میان شرق و غرب گیلان خودش بخشی از موضوع است.",
    reviews: [
      {
        id: "rv-ag-1",
        author: "شیوا ک.",
        rating: 5,
        date: "2026-02-14",
        body: "نسخه گیلکی را برای مادربزرگم گذاشتم. گفت این‌ها را از مادرش شنیده بوده. ارزشش را همان‌جا فهمیدم.",
      },
    ],
    editions: [
      {
        id: "ed_gilan_gilaki",
        voiceId: "vo_rasht",
        narratorType: "human",
        dialectSlug: "gilaki",
        priceRial: 0,
        durationSec: 16200,
        isKidsFriendly: true,
        chapters: [
          { index: 1, title: "دیو و دختر شالیکار", startSec: 0, endSec: 2700 },
          { index: 2, title: "مرد ماهیگیر", startSec: 2700, endSec: 5940 },
          { index: 3, title: "درخت انجیر", startSec: 5940, endSec: 9180 },
          { index: 4, title: "عروس دریا", startSec: 9180, endSec: 12780 },
          { index: 5, title: "پیرزن و ابر", startSec: 12780, endSec: 16200 },
        ],
        transcriptSample: [
          {
            startSec: 0,
            endSec: 8.8,
            text: "یکی بود، یکی نبود. در دهی کنار شالیزار، دختری بود که هر روز صبح پیش از آفتاب سر زمین می‌رفت.",
          },
        ],
      },
      {
        id: "ed_gilan_fa",
        voiceId: "vo_parvaneh",
        narratorType: "human",
        priceRial: 0,
        durationSec: 15300,
        isKidsFriendly: true,
        chapters: [
          { index: 1, title: "دیو و دختر شالیکار", startSec: 0, endSec: 2550 },
          { index: 2, title: "مرد ماهیگیر", startSec: 2550, endSec: 5610 },
          { index: 3, title: "درخت انجیر", startSec: 5610, endSec: 8670 },
          { index: 4, title: "عروس دریا", startSec: 8670, endSec: 12070 },
          { index: 5, title: "پیرزن و ابر", startSec: 12070, endSec: 15300 },
        ],
        transcriptSample: [
          {
            startSec: 0,
            endSec: 8.3,
            text: "یکی بود، یکی نبود. در دهی کنار شالیزار، دختری بود که هر روز صبح پیش از آفتاب سر زمین می‌رفت.",
          },
        ],
      },
    ],
  },
  {
    slug: "cheshmhayash",
    title: "چشم‌هایش",
    authorSlug: "simin-daneshvar",
    publisherSlug: "amirkabir",
    categorySlugs: ["adabiyat-dastani", "ravanshenasi"],
    publishedYear: 1331,
    language: "fa",
    description:
      "نقاش بزرگی درگذشته و تابلویی از او مانده به نام «چشم‌هایش» — پرتره زنی که هیچ‌کس نمی‌داند کیست. ناظم مدرسه‌ای که مجموعه آثار او را نگه می‌دارد، سرانجام زن را پیدا می‌کند و روایت از زبان او آغاز می‌شود.",
    summary:
      "کتاب دو راوی دارد و همین ساختار مسئله اصلی‌اش است: تصویری که یک هنرمند از کسی می‌سازد، در برابر آنچه آن شخص از خودش می‌داند. هیچ‌کدام از دو روایت کامل نیست.",
    reviews: [
      {
        id: "rv-ch-1",
        author: "مریم ه.",
        rating: 4,
        date: "2025-10-05",
        body: "دو راوی داشتن کتاب در نسخه صوتی بهتر از کاغذ کار می‌کند — انتقال بین دو صدا کاملاً واضح است.",
      },
    ],
    editions: [
      {
        id: "ed_cheshm_parvaneh",
        voiceId: "vo_parvaneh",
        narratorType: "human",
        priceRial: 950000,
        durationSec: 28800,
        isKidsFriendly: false,
        chapters: [
          { index: 1, title: "تابلو", startSec: 0, endSec: 4800 },
          { index: 2, title: "ناظم", startSec: 4800, endSec: 10800 },
          { index: 3, title: "فرنگیس", startSec: 10800, endSec: 17400 },
          { index: 4, title: "پاریس", startSec: 17400, endSec: 23400 },
          { index: 5, title: "بازگشت", startSec: 23400, endSec: 28800 },
        ],
        transcriptSample: [
          {
            startSec: 0,
            endSec: 9.6,
            text: "استاد مرده بود و از او جز چند تابلو و یک نام چیزی نمانده بود.",
          },
        ],
      },
    ],
  },
];

/* ── Collections ─────────────────────────────────────────────────────────── */

export const COLLECTIONS: Collection[] = [
  {
    slug: "sad-sal-dastan-farsi",
    title: "صد سال داستان فارسی",
    description:
      "از بوف کور تا امروز — مسیری خوانده‌شده برای کسی که می‌خواهد بداند داستان‌نویسی مدرن فارسی از کجا شروع شد و به کجا رسید.",
    bookSlugs: ["boof-e-koor", "cheshmhayash", "savushun", "ja-ye-khali-e-soluch", "daei-jan-napoleon"],
  },
  {
    slug: "gheseh-shab",
    title: "قصه شب",
    description:
      "قصه‌هایی با طول مناسب یک شب و پایانی که کودک را بیدار نمی‌گذارد. همه با صدای تأییدشده کودک.",
    bookSlugs: ["ghesse-haye-majid", "mahi-siah-koochooloo", "shazde-koochooloo", "asatir-e-gilan"],
  },
  {
    slug: "be-zaban-e-madari",
    title: "به زبان مادری",
    description:
      "آثاری که دست‌کم یک نسخه صوتی به زبان‌ها و گویش‌های ایرانی دارند — گیلکی، آذربایجانی، لری و بلوچی.",
    bookSlugs: ["asatir-e-gilan", "mahi-siah-koochooloo", "ja-ye-khali-e-soluch"],
  },
  {
    slug: "shenidan-dar-masir",
    title: "شنیدن در مسیر",
    description:
      "کتاب‌های غیرداستانی با فصل‌بندی کوتاه، ساخته‌شده برای مسیر رفت‌وآمد روزانه.",
    bookSlugs: ["sazman-e-yadgirande"],
  },
];

/* ── Blog ────────────────────────────────────────────────────────────────── */

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "chera-transcript-mohemtarin-dara-i-ast",
    title: "چرا ترنسکریپت همگام مهم‌ترین دارایی یک پلتفرم صوتی است",
    excerpt:
      "یک ساختار داده، چهار کاربرد: دسترس‌پذیری، محتوای ایندکس‌پذیر، همگام‌سازی متن و صوت، و منبع پاسخ‌گویی هوش مصنوعی.",
    author: "تیم فنی کتاپاد",
    date: "2026-02-18",
    readingMinutes: 7,
    tag: "فنی",
    body: [
      "وقتی یک کتاب صوتی تولید می‌شود، خروجی طبیعی یک فایل صوتی است. اما اگر همان‌جا، در همان خط لوله، نگاشت متن به زمان هم ذخیره شود، چیزی به دست می‌آید که ارزشش با گذشت زمان بیشتر می‌شود نه کمتر.",
      "اول: دسترس‌پذیری. شنونده ناشنوا یا کم‌شنوا بدون ترنسکریپت اصلاً مخاطب این محصول نیست. این تنها کاربردی است که معمولاً به آن فکر می‌شود و اتفاقاً کم‌اهمیت‌ترین از نظر تجاری نیست.",
      "دوم: محتوای ایندکس‌پذیر. یک کاتالوگ هزار عنوانی با ترنسکریپت، هزاران صفحه متن یکتا تولید می‌کند که هیچ رقیبی ندارد. بدون آن، صفحه هر کتاب فقط یک عنوان است و یک پاراگراف توضیح.",
      "سوم: همگام‌سازی متن و صوت. روشن‌شدن کلمه در حال خوانده‌شدن، برای کودکی که تازه خواندن یاد می‌گیرد یک ابزار سوادآموزی است، نه یک جلوه بصری.",
      "چهارم: منبع context برای دستیار. وقتی کاربر می‌پرسد «این فصل درباره چه بود؟»، پاسخ باید از متن همان فصل بیاید. اگر ترنسکریپت وجود نداشته باشد، باید کل کتاب دوباره پردازش شود.",
      "نتیجه عملی ساده است: ترنسکریپت را از روز اول تولید کنید. تولید دوباره آن برای کاتالوگی که یک سال رشد کرده، پرهزینه‌ترین کاری است که می‌شود انجام داد.",
    ],
  },
  {
    slug: "48-kilobit-mono",
    title: "چهل‌وهشت کیلوبیت مونو: یک تصمیم فنی که تصمیم مالی است",
    excerpt:
      "برای گفتار، تفاوت ۴۸ کیلوبیت مونو با ۱۲۸ کیلوبیت استریو عملاً شنیده نمی‌شود — ولی در قبض پهنای باند کاملاً دیده می‌شود.",
    author: "تیم فنی کتاپاد",
    date: "2026-02-04",
    readingMinutes: 5,
    tag: "فنی",
    body: [
      "موسیقی به پهنای باند نیاز دارد چون طیف فرکانسی گسترده‌ای دارد و تصویر استریو بخشی از خود اثر است. گفتار هیچ‌کدام را ندارد.",
      "صدای انسان تقریباً تمام انرژی‌اش زیر هشت کیلوهرتز است و یک گوینده در اتاق ضبط، منبع نقطه‌ای است — یعنی کانال دوم عملاً کپی کانال اول است.",
      "نتیجه: ۴۸ کیلوبیت مونو برای گفتار، در تست شنیداری از ۱۲۸ کیلوبیت استریو قابل تفکیک نیست، اما حدود دو‌سوم هزینه انتقال را حذف می‌کند.",
      "چرا این تصمیم باید روز اول گرفته شود؟ چون هزینه پهنای باند با موفقیت محصول خطی بالا می‌رود. اگر بعد از رسیدن به صد هزار کاربر بخواهید تغییرش دهید، باید کل کاتالوگ را دوباره ترنسکد کنید — و تا آن روز چند برابر پرداخت کرده‌اید.",
    ],
  },
  {
    slug: "kudak-mosarrafkonande-valed-tasmimgirande",
    title: "کودک مصرف می‌کند، والد تصمیم می‌گیرد",
    excerpt:
      "در محصول کودک، کسی که گوش می‌دهد پول نمی‌دهد و کسی که پول می‌دهد گوش نمی‌دهد. کل معماری این بخش از همین یک جمله بیرون می‌آید.",
    author: "تیم محصول کتاپاد",
    date: "2026-01-22",
    readingMinutes: 6,
    tag: "محصول",
    body: [
      "بیشتر محصولات کودک وقتی شکست می‌خورند که فرض کنند کودک کاربر است. کودک شنونده است؛ کاربرِ تصمیم‌گیرنده والد است.",
      "این یعنی دو تجربه کاملاً متفاوت روی یک حساب: تجربه‌ای برای کودک که در آن هیچ متن سنگینی، هیچ منوی تودرتویی و هیچ ورودی متن آزادی وجود ندارد؛ و پنلی برای والد که در آن سقف زمان، تأیید محتوا و گزارش هفتگی هست.",
      "چهار قاعده در نسخه کودک شکسته نمی‌شوند: هیچ تبلیغی در هیچ شکلی؛ هیچ ورودی متن آزاد به هوش مصنوعی؛ هیچ محتوای تولیدشده توسط کاربران غریبه؛ و هیچ نوتیفیکیشنی به دستگاه کودک — همه به گوشی والد.",
      "نکته فنی مهم: این چهار قاعده باید در بک‌اند به‌صورت policy پیاده شوند، نه به‌صورت شرط در فرانت. اگر اعمالشان یک‌طرفه و سمت کلاینت باشد، یک لینک مستقیم آن را دور می‌زند.",
    ],
  },
  {
    slug: "gooyesh-ha-baazar-nist-mas-uliyat-ast",
    title: "گویش‌ها یک بازار نیستند، یک فرصت‌اند",
    excerpt:
      "چرا کاتالوگ گیلکی و بلوچی و کرمانجی هم‌زمان کم‌رقابت‌ترین ترافیک ارگانیک و بامعناترین بخش محصول است.",
    author: "تیم محتوای کتاپاد",
    date: "2026-01-09",
    readingMinutes: 5,
    tag: "محتوا",
    body: [
      "ادبیات شفاهی ایران عمدتاً مکتوب نشده است. این یعنی برای بخش بزرگی از آن، صوت قالب دوم نیست — قالب اصلی است.",
      "از منظر محصول، هر گویش یک صفحه فرود مستقل است با کوئری‌هایی که تقریباً هیچ رقیبی برایشان محتوا تولید نکرده. ارزان‌ترین ترافیک ارگانیکی که یک کاتالوگ تازه می‌تواند به دست بیاورد.",
      "اما نکته‌ای که راحت اشتباه گرفته می‌شود این است: یک ضبط واحد برای هر «زبان» کافی نیست. کرمانجی خراسان با کرمانجی آذربایجان غربی تفاوت آوایی دارد؛ لری مرکزی با بختیاری همین‌طور. شنونده تفاوت را در جمله اول می‌فهمد.",
      "بنابراین مدل داده باید از ابتدا اجازه دهد یک کتاب چند نسخه صوتی داشته باشد، هر کدام با گویش خودش. بدون آن، کاتالوگ گویش‌ها اصلاً ساختنی نیست.",
    ],
  },
];
