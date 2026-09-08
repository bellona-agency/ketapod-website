import { Mail, Phone } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark, BrandWord } from "@/components/primitives/BrandMark";
import { Reveal } from "@/components/primitives/Reveal";
import { CATEGORIES, DIALECTS } from "@/lib/catalog";
import { FOOTER } from "@/lib/content";
import { LEAD_HREF, routes } from "@/lib/routes";

/* Lucide dropped its brand glyphs, so these two are drawn here. */
const SOCIAL_PATHS: Record<string, string> = {
  Instagram:
    "M12 2.2c3.2 0 3.6 0 4.9.07 1.2.05 1.8.25 2.2.42.6.22 1 .48 1.4.9.4.4.7.8.9 1.4.2.4.4 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c0 1.2-.2 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .4-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2 0-1.8-.2-2.2-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.4-1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.9c0-1.2.2-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.4 2.2-.4C8.4 2.2 8.8 2.2 12 2.2Zm0 3.05A6.75 6.75 0 1 0 18.75 12 6.76 6.76 0 0 0 12 5.25Zm0 11.13A4.38 4.38 0 1 1 16.38 12 4.38 4.38 0 0 1 12 16.38Zm6.99-11.4a1.58 1.58 0 1 1-1.58-1.58 1.58 1.58 0 0 1 1.58 1.58Z",
  LinkedIn:
    "M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9h4v12H3V9Zm7 0h3.8v1.65h.05A4.17 4.17 0 0 1 17.6 8.7c4 0 4.75 2.5 4.75 5.8V21h-4v-5.7c0-1.36-.03-3.1-1.9-3.1s-2.2 1.47-2.2 3v5.8h-4V9Z",
};

/**
 * Site footer.
 *
 * On a one-page site this was three scroll targets. On an SEO-first catalogue it
 * is load-bearing: the footer is the only place every category and every dialect
 * page is linked from every page on the site, which is how a new catalogue with
 * no external authority gets its deep pages crawled at all.
 *
 * It is a server component now — nothing here holds state, and the links are
 * real anchors.
 */
export function Footer() {
  return (
    <footer className="relative overflow-hidden bg-night pt-16 text-night-ink">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-[20%] size-[420px] rounded-full bg-[radial-gradient(circle,rgba(42,56,255,0.20)_0%,transparent_68%)]" />
      </div>

      <div className="container-k relative">
        <div className="grid gap-12 pb-14 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1.1fr]">
          {/* Brand */}
          <div>
            <BrandMark tone="night" animated={false} size={40} />
            <p className="mt-5 max-w-[34ch] text-[16px] leading-[1.75] text-night-muted sm:leading-[2]">
              {FOOTER.brandDescription}
            </p>

            <div className="mt-6 flex items-center gap-2.5">
              {FOOTER.socials.map((s) => (
                <a
                  key={s.name}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={s.name}
                  className="lift grid size-10 place-items-center rounded-full border border-night-line text-night-muted transition-[color,border-color,transform] duration-200 hover:border-violet-200 hover:text-violet-200"
                >
                  <svg viewBox="0 0 24 24" className="size-[18px]" fill="currentColor" aria-hidden>
                    <path d={SOCIAL_PATHS[s.name] ?? SOCIAL_PATHS.LinkedIn} />
                  </svg>
                </a>
              ))}
            </div>
          </div>

          <FooterColumn title="کشف">
            <FooterLink href={routes.books()}>همه کتاب‌ها</FooterLink>
            <FooterLink href={routes.voices()}>گویندگان</FooterLink>
            <FooterLink href={routes.dialects()}>گویش‌ها و زبان‌ها</FooterLink>
            <FooterLink href={routes.collection("sad-sal-dastan-farsi")}>
              صد سال داستان فارسی
            </FooterLink>
            <FooterLink href={routes.collection("gheseh-shab")}>قصه شب</FooterLink>
          </FooterColumn>

          {/* Every category, from every page — the cheapest indexable pages in
              the project, per the spec, and worth nothing unlinked. */}
          <FooterColumn title="دسته‌ها">
            {CATEGORIES.map((c) => (
              <FooterLink key={c.slug} href={routes.category(c.slug)}>
                {c.title}
              </FooterLink>
            ))}
          </FooterColumn>

          <FooterColumn title="زبان‌ها">
            {DIALECTS.map((d) => (
              <FooterLink key={d.slug} href={routes.dialect(d.slug)}>
                {d.title}
              </FooterLink>
            ))}
          </FooterColumn>

          <FooterColumn title="کتاپاد">
            <FooterLink href={routes.ai()}>کتاب‌یار</FooterLink>
            <FooterLink href={routes.kids()}>کتاپاد کودک</FooterLink>
            <FooterLink href={routes.blog()}>بلاگ</FooterLink>
            {FOOTER.legalLinks.map((l) => (
              <FooterLink key={l.url} href={l.url}>
                {l.label}
              </FooterLink>
            ))}
            <FooterLink href={LEAD_HREF}>همکاری با کتاپاد</FooterLink>

            <li className="pt-2">
              <a
                href={`mailto:${FOOTER.contact.email}`}
                className="flex items-center gap-2.5 text-[16px] text-night-muted transition-colors duration-200 hover:text-white"
              >
                <Mail className="size-4 shrink-0" strokeWidth={1.7} aria-hidden />
                <span dir="ltr">{FOOTER.contact.email}</span>
              </a>
            </li>
            <li>
              <a
                href={`tel:${FOOTER.contact.phone.replace(/\s/g, "")}`}
                className="flex items-center gap-2.5 text-[16px] text-night-muted transition-colors duration-200 hover:text-white"
              >
                <Phone className="size-4 shrink-0" strokeWidth={1.7} aria-hidden />
                <span dir="ltr">{FOOTER.contact.phone}</span>
              </a>
            </li>
          </FooterColumn>
        </div>

        {/* Oversized wordmark — the page signs off */}
        <Reveal
          amount={0.3}
          className="relative select-none overflow-hidden border-t border-night-line pt-8"
        >
          <BrandWord className="mx-auto w-[78%] max-w-[680px] text-violet-200/[0.11]" />
        </Reveal>

        <div className="flex flex-col items-center justify-between gap-3 border-t border-night-line py-6 sm:flex-row">
          <p className="text-[15px] text-night-muted">{FOOTER.copyright}</p>
          <p className="text-[15px] text-night-muted">
            ساخته‌شده برای شنیدن، نه فقط شنیده‌شدن.
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="eyebrow text-white/45">{title}</h3>
      <ul className="mt-5 flex flex-col gap-3.5">{children}</ul>
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        className="text-[16px] text-night-muted transition-colors duration-200 hover:text-white"
      >
        {children}
      </Link>
    </li>
  );
}
