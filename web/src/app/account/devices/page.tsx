"use client";

import { Loader2, MonitorSmartphone, Smartphone } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSession } from "@/components/account/SessionProvider";
import { useResource } from "@/hooks/useResource";
import { getDevices, revokeDevice } from "@/lib/platform";
import { fmtAgo } from "@/lib/utils";

/**
 * Signed-in devices, and the cap on how many can play at once.
 *
 * The spec gives `Device` three jobs and this screen is where two of them meet
 * the person who owns them: seeing what is signed in, and cutting off something
 * that should not be. The third — notification targeting — is invisible here on
 * purpose, because a "send alerts to this device" toggle would be the first
 * place someone tried to route a child's notifications away from the parent.
 *
 * Revoking the current device signs you out. The button says so before you
 * press it rather than after, which is the difference between a confirmation
 * and an apology.
 */
export default function DevicesPage() {
  const { data, error, reload } = useResource(getDevices, "/account/devices");
  const { refresh } = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function revoke(id: string, isCurrent: boolean) {
    if (isCurrent && !window.confirm("این همان دستگاهی است که با آن وارد شده‌اید. خارج شوید؟")) {
      return;
    }
    setBusy(id);
    try {
      const res = await revokeDevice(id);
      if (res.revokedSelf) {
        /* The cookie is already cleared by the endpoint. Re-reading the session
           drops the provider to `anonymous` before we navigate, so the header
           does not still show an account menu on the login screen. */
        await refresh();
        router.replace("/login");
        return;
      }
      reload();
    } finally {
      setBusy(null);
    }
  }

  if (error) return <p className="py-20 text-center text-muted">{error}</p>;
  if (!data) {
    return <Loader2 className="mx-auto mt-16 size-6 animate-spin text-muted" aria-label="بارگیری" />;
  }

  const overCap = data.devices.length > data.concurrentCap;

  return (
    <div>
      <span className="eyebrow text-muted">امنیت</span>
      <h1 className="mt-2 text-[27px] font-bold text-ink sm:text-[34px]">دستگاه‌ها</h1>

      <div className="card mt-7 flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <p className="text-[14px] text-muted">پخش هم‌زمان</p>
          <p className="tnum mt-1 text-[22px] font-bold text-ink">
            {data.devices.length.toLocaleString("fa-IR")} از{" "}
            {data.concurrentCap.toLocaleString("fa-IR")}
          </p>
          <p className="mt-0.5 text-[13px] text-faint">بر اساس طرح {data.capSource}</p>
        </div>
        {data.upgradeTo.length > 0 && (
          <Link
            href="/account/subscription"
            className="btn inline-flex h-11 items-center rounded-lg border border-line bg-card px-5 text-[15px] font-bold text-ink transition-colors hover:border-violet-200"
          >
            ارتقای طرح
          </Link>
        )}
      </div>

      {overCap && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-[14px] leading-[1.85] text-amber-800">
          تعداد دستگاه‌های واردشده از سقف طرح بیشتر است. پخش هم‌زمان روی
          دستگاه‌های اضافه رد می‌شود — یکی را خارج کنید یا طرح را ارتقا دهید.
        </p>
      )}

      <ul className="mt-6 flex flex-col gap-2">
        {data.devices.map((d) => (
          <li
            key={d.id}
            className="flex items-center gap-4 rounded-lg border border-line bg-card px-5 py-4"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-paper-2 text-ink-2" aria-hidden>
              {/^.*(iphone|android|mobile).*$/i.test(d.label) ? (
                <Smartphone className="size-4" strokeWidth={1.9} />
              ) : (
                <MonitorSmartphone className="size-4" strokeWidth={1.9} />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium text-ink">
                {/* The user agent, shortened. It is not a device name — the spec
                    has no field for one — and showing the whole string turns a
                    list of devices into a wall of version numbers. */}
                {shorten(d.label)}
              </span>
              <span className="block text-[13px] text-faint">
                آخرین فعالیت: {fmtAgo(d.lastSeenAt)}
              </span>
            </span>
            {d.current && (
              <span className="chip chip-paper shrink-0 text-[12px]">همین دستگاه</span>
            )}
            <button
              type="button"
              onClick={() => void revoke(d.id, d.current)}
              disabled={busy !== null}
              className="btn shrink-0 cursor-pointer rounded-lg border border-line px-4 py-2 text-[14px] font-medium text-muted transition-colors hover:border-red-200 hover:text-red-700 disabled:opacity-60"
            >
              {busy === d.id ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                "خروج"
              )}
            </button>
          </li>
        ))}
      </ul>

      {data.devices.length === 0 && (
        <p className="py-16 text-center text-[15px] text-muted">دستگاهی ثبت نشده است.</p>
      )}
    </div>
  );
}

/** Pull the browser and platform out of a user-agent string, or give up
 *  cleanly. Guessing wrong is fine here; guessing at length is not. */
function shorten(ua: string) {
  const browser =
    /edg/i.test(ua) ? "Edge"
    : /chrome/i.test(ua) ? "Chrome"
    : /safari/i.test(ua) ? "Safari"
    : /firefox/i.test(ua) ? "Firefox"
    : null;
  const os =
    /windows/i.test(ua) ? "ویندوز"
    : /android/i.test(ua) ? "اندروید"
    : /iphone|ipad|ios/i.test(ua) ? "iOS"
    : /mac os/i.test(ua) ? "مک"
    : /linux/i.test(ua) ? "لینوکس"
    : null;

  if (browser && os) return `${browser} روی ${os}`;
  return ua.length > 48 ? `${ua.slice(0, 48)}…` : ua;
}
