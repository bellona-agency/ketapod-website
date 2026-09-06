"use client";

import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandIcon, BrandMark } from "@/components/primitives/BrandMark";
import { Cta } from "@/components/primitives/Cta";
import { PRIMARY_CTA_LABEL } from "@/lib/content";
import { trackEvent } from "@/lib/api";
import { isActivePath, LEAD_HREF, NAV_LINKS, routes } from "@/lib/routes";
import { EASE_OUT_EXPO, springSoft } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Site header.
 *
 * This used to be a scroll-spy over the sections of a single page. Now that the
 * public surface is a set of routes, the active item comes from the pathname
 * instead — and every item is a real `<Link>`, because the nav is the primary
 * internal-linking structure of an SEO-first site and a crawler cannot press a
 * button.
 *
 * The chrome itself is unchanged: the same pill that gains a background past
 * 24px of scroll, the same drawer, the same shared `layoutId` pill behind the
 * active item.
 */
export function Header() {
  const { scrollY } = useScroll();
  const pathname = usePathname();
  const [condensed, setCondensed] = useState(false);
  const [open, setOpen] = useState(false);

  useMotionValueEvent(scrollY, "change", (v) => setCondensed(v > 24));

  /* Lock the page while the drawer owns the screen. */
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  /* The drawer closes on the click that navigates, not in an effect watching
     the pathname. Same result, but it is the interaction that closes it rather
     than a render pass reacting to its own consequence. */
  const closeDrawer = () => setOpen(false);

  return (
    <>
      <motion.header
        className="fixed inset-x-0 top-0 z-50 px-3 pt-3 md:px-5 md:pt-4"
        initial={{ y: -24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.7, ease: EASE_OUT_EXPO, delay: 0.05 }}
      >
        <motion.div
          className={cn(
            "mx-auto flex max-w-[1216px] items-center gap-3 rounded-full transition-[background-color,box-shadow,border-color] duration-400",
            condensed
              ? "border border-line bg-card/85 shadow-e3 backdrop-blur-xl"
              : "border border-transparent bg-transparent",
          )}
          animate={{ paddingInline: condensed ? 12 : 8 }}
          transition={springSoft}
        >
          {/* Brand — now the site's home link rather than a scroll-to-top. */}
          <Link
            href={routes.home()}
            className="flex shrink-0 items-center rounded-full py-1 pr-1"
            aria-label="کتاپاد — صفحه اصلی"
          >
            <BrandIcon className="size-[52px] sm:size-[58px]" />
          </Link>

          {/* Desktop nav */}
          <nav className="mr-2 hidden flex-1 items-center xl:flex" aria-label="ناوبری اصلی">
            {NAV_LINKS.map((item) => {
              const active = isActivePath(item.href, pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative rounded-full px-3.5 py-2 text-[17px] font-medium transition-colors duration-200",
                    active ? "text-ink" : "text-muted hover:text-ink",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-pill"
                      className="absolute inset-0 -z-10 rounded-full bg-violet-50 ring-1 ring-violet-100"
                      transition={springSoft}
                    />
                  )}
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex flex-1 items-center justify-end gap-2 xl:flex-none">
            <div className="hidden sm:block">
              <Cta
                label={PRIMARY_CTA_LABEL}
                href={LEAD_HREF}
                event="header_cta_clicked"
                section="header"
                element="header_cta"
                variant="primary"
                arrow={false}
                className="h-12 min-h-12 px-6 text-[17px]"
              />
            </div>

            <button
              type="button"
              onClick={() => setOpen(true)}
              className="grid size-12 cursor-pointer place-items-center rounded-full border border-line bg-card/70 text-ink xl:hidden"
              aria-label="باز کردن منو"
              aria-expanded={open}
            >
              <Menu className="size-5" strokeWidth={1.8} />
            </button>
          </div>
        </motion.div>
      </motion.header>

      {/* Mobile drawer */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="drawer"
            className="fixed inset-0 z-60 xl:hidden"
            initial="hidden"
            animate="show"
            exit="hidden"
          >
            <motion.button
              type="button"
              aria-label="بستن منو"
              onClick={() => setOpen(false)}
              className="absolute inset-0 cursor-pointer bg-ink/35 backdrop-blur-sm"
              variants={{ hidden: { opacity: 0 }, show: { opacity: 1 } }}
              transition={{ duration: 0.25 }}
            />
            <motion.div
              className="absolute inset-y-0 right-0 flex w-[86%] max-w-[360px] flex-col bg-paper shadow-e4"
              variants={{ hidden: { x: "100%" }, show: { x: 0 } }}
              transition={{ duration: 0.45, ease: EASE_OUT_EXPO }}
            >
              <div className="flex items-center justify-between border-b border-line px-5 py-4">
                <BrandMark animated={false} />
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="grid size-10 cursor-pointer place-items-center rounded-full border border-line text-ink transition-colors hover:bg-paper-2"
                  aria-label="بستن منو"
                >
                  <X className="size-5" strokeWidth={1.8} />
                </button>
              </div>

              <motion.nav
                className="flex flex-1 flex-col gap-1 overflow-y-auto p-4"
                variants={{
                  hidden: {},
                  show: { transition: { staggerChildren: 0.05, delayChildren: 0.12 } },
                }}
                aria-label="ناوبری موبایل"
              >
                {NAV_LINKS.map((item, i) => (
                  <motion.div
                    key={item.href}
                    variants={{ hidden: { opacity: 0, x: 24 }, show: { opacity: 1, x: 0 } }}
                  >
                    <Link
                      href={item.href}
                      onClick={closeDrawer}
                      aria-current={isActivePath(item.href, pathname) ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-3 py-3.5 text-right text-[18px] font-medium transition-colors hover:bg-paper-2",
                        isActivePath(item.href, pathname) ? "bg-violet-50 text-violet" : "text-ink",
                      )}
                    >
                      <span className="tnum text-[13px] text-faint">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      {item.label}
                    </Link>
                  </motion.div>
                ))}
              </motion.nav>

              <div className="border-t border-line p-4">
                <Link
                  href={LEAD_HREF}
                  onClick={() => {
                    trackEvent("header_cta_clicked", "header", "drawer_cta", {
                      target: LEAD_HREF,
                    });
                    closeDrawer();
                  }}
                  className="btn btn-primary w-full"
                >
                  {PRIMARY_CTA_LABEL}
                </Link>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
