import Link from "next/link";
import { CATEGORIES } from "@/lib/catalog";
import { routes } from "@/lib/routes";

/**
 * 404.
 *
 * A dead end on a catalogue site is a chance to route someone back into it, so
 * this offers the shelves rather than a back button. No `PageView` — a 404 is
 * not a page anyone meant to land on and counting it as one skews the funnel.
 */
export default function NotFound() {
  return (
    <main className="pt-24 sm:pt-32 md:pt-40">
      <div className="container-k section-rhythm">
        <div className="mx-auto max-w-[52ch] text-center">
          <p className="eyebrow justify-center">۴۰۴</p>
          <h1 className="mt-5 text-[30px] font-extrabold leading-[1.35] text-ink sm:text-[40px]">
            این صفحه پیدا نشد
          </h1>
          <p className="mt-4 text-[17px] leading-[1.85] text-muted sm:text-[19px]">
            ممکن است نشانی تغییر کرده باشد یا کتابی که دنبالش بودید هنوز به کاتالوگ اضافه نشده
            باشد.
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href={routes.books()} className="btn btn-primary">
              همه کتاب‌ها
            </Link>
            <Link href={routes.home()} className="btn btn-ghost">
              صفحه اصلی
            </Link>
          </div>

          <ul className="mt-10 flex flex-wrap justify-center gap-2">
            {CATEGORIES.map((category) => (
              <li key={category.slug}>
                <Link
                  href={routes.category(category.slug)}
                  className="inline-flex rounded-full border border-line-2 bg-card px-4 py-2 text-[15px] font-medium text-ink-2 transition-colors duration-200 hover:border-violet hover:bg-violet-50 hover:text-violet"
                >
                  {category.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}
