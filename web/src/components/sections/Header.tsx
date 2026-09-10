"use client";

import { LibraryBig, LogIn, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AccountMenu } from "@/components/account/AccountMenu";
import { useSession } from "@/components/account/SessionProvider";
import { BrandIcon, BrandMark } from "@/components/primitives/BrandMark";
import { trackEvent } from "@/lib/api";
import { isActivePath, NAV_LINKS, routes } from "@/lib/routes";
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
 * The chrome reads the same as before: the pill gains a background past 24px of
 * scroll, the drawer slides in from the RTL start edge, and the active item
 * carries a pill. What changed is that none of it runs through an animation
 * library any more — see the header and drawer rules in `globals.css` for why
 * that mattered enough to give up the sliding pill.
 */
export function Header() {
  const pathname = usePathname();
  const [condensed, setCondensed] = useState(false);
  const [open, setOpen] = useState(false);
  const { me, status } = useSession();

  /*
   * `useScroll` + `useMotionValueEvent` did this before. A passive listener is
   * the whole of what was being used, and the ref guard means a scroll only
   * reaches React on the two frames where the flag actually flips rather than
   * on all of them.
   */
  const condensedRef = useRef(false);
  useEffect(() => {
    const onScroll = () => {
      const next = window.scrollY > 24;
      if (next === condensedRef.current) return;
      condensedRef.current = next;
      setCondensed(next);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* Lock the page while the drawer owns the screen. */
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  /* Escape closes it, which the drawer got for free from AnimatePresence's
     focus handling before and now has to ask for. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /* The drawer closes on the click that navigates, not in an effect watching
     the pathname. Same result, but it is the interaction that closes it rather
     than a render pass reacting to its own consequence. */
  const closeDrawer = () => setOpen(false);

  return (
    <>
      <header className="kp-header-in fixed inset-x-0 top-0 z-50 px-3 pt-3 md:px-5 md:pt-4">
        <div
          className={cn(
            "mx-auto flex max-w-[1216px] items-center gap-3 rounded-full transition-[background-color,box-shadow,border-color,padding-inline] duration-400 ease-[var(--ease-out-quint)]",
            condensed
              ? "border border-line bg-card/85 px-3 shadow-e3"
              : "border border-transparent bg-transparent px-2",
            /* The pill's blur is dropped while the drawer is open. The header
               sits under a full-screen scrim then, so the blur is doing work
               nobody can see — and it is the layer the scrim would otherwise
               have to composite through. */
            condensed && !open && "backdrop-blur-xl",
          )}
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
                    <span
                      /* `key` restarts the fade when the active route changes;
                         without it React reuses the node across navigations and
                         the pill simply teleports. */
                      key={item.href}
                      className="kp-nav-pill absolute inset-0 -z-10 rounded-full bg-violet-50 ring-1 ring-violet-100"
                    />
                  )}
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex flex-1 items-center justify-end gap-2 xl:flex-none">
            {/*
              The auth corner.

              Three states, and the third is why this is not a plain link. The
              session is resolved in the browser after hydration — see
              `SessionProvider` for why it cannot be resolved on the server
              without giving up static catalogue pages — so there is a moment
              where the answer is unknown. Rendering «ورود» during it would
              flash "signed out" at a signed-in reader on every navigation, so
              that moment renders a placeholder of the same width instead and
              the row never reflows.
            */}
            {status === "loading" ? (
              <div
                className="hidden h-12 w-[168px] rounded-full bg-paper-2/70 sm:block"
                aria-hidden
              />
            ) : me ? (
              <>
                <Link
                  href="/library"
                  className="hidden h-12 items-center gap-2 rounded-full border border-line bg-card/70 px-5 text-[16px] font-medium text-ink transition-colors hover:border-violet-200 sm:inline-flex"
                >
                  <LibraryBig className="size-4" strokeWidth={1.7} aria-hidden />
                  کتابخانه
                </Link>
                <AccountMenu me={me} />
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="hidden h-12 items-center gap-2 rounded-full border border-line bg-card/70 px-5 text-[16px] font-medium text-ink transition-colors hover:border-violet-200 sm:inline-flex"
                >
                  <LogIn className="size-4" strokeWidth={1.7} aria-hidden />
                  ورود
                </Link>
                {/* Sign-up and sign-in are one screen — the spec's identity is a
                    phone number and an OTP, so there is no second form to send
                    people to. The two buttons differ in the promise they make,
                    not in where they land: `?new=1` opens the same page with
                    the wording of a first visit. */}
                <Link
                  href="/login?new=1"
                  className="btn btn-primary hidden h-12 min-h-12 items-center px-6 text-[17px] sm:inline-flex"
                >
                  ثبت‌نام رایگان
                </Link>
              </>
            )}

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
        </div>
      </header>

      {/*
        Mobile drawer. Permanently mounted and toggled through `data-open` —
        `AnimatePresence` was only ever here to keep the panel alive long enough
        to animate out, and CSS can do that as long as the node stays.

        `inert` is what makes that safe: closed, the drawer's links leave the tab
        order and the accessibility tree, so a keyboard user cannot land inside a
        panel that is not on screen.
      */}
      <div
        className="kp-drawer fixed inset-0 z-60 xl:hidden"
        data-open={open || undefined}
        inert={!open}
      >
        <button
          type="button"
          aria-label="بستن منو"
          onClick={() => setOpen(false)}
          className="kp-drawer-scrim absolute inset-0 cursor-pointer bg-ink/45"
        />
        <div className="kp-drawer-panel absolute inset-y-0 right-0 flex w-[86%] max-w-[360px] flex-col bg-paper shadow-e4">
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

          {/* The stagger is a CSS keyframe with a per-item delay rather than six
              motion instances — see `.kp-drawer-item`. It runs while the panel
              is still sliding, so it is the one place on this page where the
              difference is felt rather than measured. */}
          <nav
            className="flex flex-1 flex-col gap-1 overflow-y-auto p-4"
            aria-label="ناوبری موبایل"
          >
            {NAV_LINKS.map((item, i) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeDrawer}
                aria-current={isActivePath(item.href, pathname) ? "page" : undefined}
                className={cn(
                  "kp-drawer-item flex items-center gap-3 rounded-md px-3 py-3.5 text-right text-[18px] font-medium transition-colors hover:bg-paper-2",
                  isActivePath(item.href, pathname) ? "bg-violet-50 text-violet" : "text-ink",
                )}
                style={{ "--kp-delay": `${(0.12 + i * 0.05).toFixed(2)}s` } as CSSProperties}
              >
                <span className="tnum text-[13px] text-faint">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {item.label}
              </Link>
            ))}

            {me && (
              <Link
                href="/library"
                onClick={closeDrawer}
                className="kp-drawer-item mt-2 flex items-center gap-3 rounded-md border border-line px-3 py-3.5 text-right text-[18px] font-medium text-ink transition-colors hover:bg-paper-2"
                style={{ "--kp-delay": `${(0.12 + NAV_LINKS.length * 0.05).toFixed(2)}s` } as CSSProperties}
              >
                <LibraryBig className="size-5" strokeWidth={1.7} aria-hidden />
                کتابخانه من
              </Link>
            )}
          </nav>

          {/* The drawer's foot carries the same three states as the desktop
              corner. While the session is unknown it shows nothing rather than
              a placeholder — the drawer is only on screen because the visitor
              opened it, by which time the fetch has long since resolved. */}
          <div className="border-t border-line p-4">
            {status === "loading" ? null : me ? (
              <div className="grid gap-2">
                <Link
                  href="/account"
                  onClick={closeDrawer}
                  className="btn btn-primary w-full"
                >
                  حساب کاربری
                </Link>
                <p className="tnum text-center text-[13px] text-faint">
                  {me.name ?? me.phone}
                </p>
              </div>
            ) : (
              <div className="grid gap-2">
                <Link
                  href="/login?new=1"
                  onClick={() => {
                    trackEvent("header_cta_clicked", "header", "drawer_signup", {
                      target: "/login?new=1",
                    });
                    closeDrawer();
                  }}
                  className="btn btn-primary w-full"
                >
                  ثبت‌نام رایگان
                </Link>
                <Link
                  href="/login"
                  onClick={closeDrawer}
                  className="flex h-12 w-full items-center justify-center rounded-lg border border-line text-[16px] font-medium text-ink transition-colors hover:bg-paper-2"
                >
                  ورود به حساب
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
