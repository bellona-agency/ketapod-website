"use client";

import { Check, Loader2, Pencil } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useSession } from "@/components/account/SessionProvider";
import { formatDate } from "@/lib/catalog";
import { ApiError, updateProfile } from "@/lib/platform";
import { fmtToman } from "@/lib/utils";

/**
 * The panel's front page.
 *
 * Reads entirely from the session the provider already fetched, so opening the
 * account does not cost a request. The one thing it writes is the display name —
 * the phone is the login identity and changing it is a re-verification flow, not
 * a text field, which is why it is shown as fixed text with no edit affordance
 * at all rather than as a disabled input someone will keep trying to click.
 */
export default function AccountOverviewPage() {
  const { me, status, refresh } = useSession();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "loading") {
    return <Loader2 className="mx-auto mt-16 size-6 animate-spin text-muted" aria-label="بارگیری" />;
  }
  if (!me) return null;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await updateProfile(draft);
      await refresh();
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ذخیره نشد.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <span className="eyebrow text-muted">حساب کاربری</span>
      <h1 className="mt-2 text-[27px] font-bold text-ink sm:text-[34px]">
        {me.name ?? "خوش آمدید"}
      </h1>

      <section className="card mt-7 p-6">
        <h2 className="text-[15px] font-bold text-muted">مشخصات</h2>

        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-[13px] text-faint">نام نمایشی</dt>
            <dd className="mt-1">
              {editing ? (
                <div className="flex gap-2">
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    autoFocus
                    maxLength={60}
                    aria-label="نام نمایشی"
                    className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-card px-3 text-[15px] text-ink outline-none focus:border-violet-200"
                  />
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={saving}
                    className="btn grid size-10 shrink-0 place-items-center rounded-lg bg-violet text-white disabled:opacity-60"
                    aria-label="ذخیره نام"
                  >
                    {saving ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Check className="size-4" aria-hidden />
                    )}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setDraft(me?.name ?? "");
                    setEditing(true);
                  }}
                  className="group flex cursor-pointer items-center gap-2 text-[16px] font-medium text-ink"
                >
                  {me.name ?? <span className="text-faint">تعیین نشده</span>}
                  <Pencil
                    className="size-3.5 text-faint transition-colors group-hover:text-violet"
                    aria-hidden
                  />
                  <span className="sr-only">ویرایش نام</span>
                </button>
              )}
              {error && (
                <p role="alert" className="mt-1.5 text-[13px] text-red-700">
                  {error}
                </p>
              )}
            </dd>
          </div>

          <div>
            <dt className="text-[13px] text-faint">شماره موبایل</dt>
            <dd className="tnum mt-1 text-[16px] font-medium text-ink">{me.phone}</dd>
            <p className="mt-1 text-[12px] text-faint">
              شماره، شناسه‌ی ورود است و از این صفحه تغییر نمی‌کند.
            </p>
          </div>

          <div>
            <dt className="text-[13px] text-faint">عضو از</dt>
            <dd className="tnum mt-1 text-[16px] font-medium text-ink">
              {formatDate(me.createdAt)}
            </dd>
          </div>

          <div>
            <dt className="text-[13px] text-faint">کد دعوت شما</dt>
            <dd className="tnum mt-1 text-[16px] font-medium text-ink">{me.referralCode}</dd>
          </div>
        </dl>
      </section>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Tile href="/wallet" label="موجودی کیف پول" value={fmtToman(me.walletBalanceRial)} />
        <Tile
          href="/library"
          label="کتاب‌های شما"
          value={`${me.entitlementCount.toLocaleString("fa-IR")} نسخه`}
        />
        <Tile
          href="/account/subscription"
          label="اشتراک"
          value={me.subscription ? me.subscription.tierName : "ندارید"}
          note={
            me.subscription
              ? `${me.subscription.daysLeft.toLocaleString("fa-IR")} روز مانده`
              : "طرح‌ها را ببینید"
          }
        />
      </div>

      {/* The studio tile, gated on the role the server sent. The spec is
          explicit that this is «یک نقش است نه یک شخص» and appears inside the
          account rather than as a separate app — and that the decision belongs
          to the backend, which is why nothing here infers it. */}
      {me.roles.includes("creator") && (
        <section className="card mt-6 border-violet-100 bg-violet-50/50 p-6">
          <h2 className="text-[17px] font-bold text-ink">نقش سازنده</h2>
          <p className="mt-2 max-w-[56ch] text-[15px] leading-[1.85] text-muted">
            حساب شما نقش «سازنده» دارد. می‌توانید فایل PDF بفرستید تا با صدای
            انتخابی‌تان روایت شود.
          </p>
          <Link
            href="/account/narration"
            className="btn mt-4 inline-flex h-11 items-center rounded-lg bg-violet px-5 text-[15px] font-bold text-white"
          >
            ارسال کتاب برای گویندگی
          </Link>
        </section>
      )}
    </div>
  );
}

function Tile({
  href,
  label,
  value,
  note,
}: {
  href: string;
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <Link href={href} className="card p-5 transition-colors hover:border-violet-200">
      <p className="text-[13px] text-muted">{label}</p>
      <p className="tnum mt-2 text-[20px] font-bold text-ink">{value}</p>
      {note && <p className="tnum mt-0.5 text-[13px] text-faint">{note}</p>}
    </Link>
  );
}
