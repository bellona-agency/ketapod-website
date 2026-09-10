"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useResource } from "@/hooks/useResource";
import { DIALECTS } from "@/lib/catalog";
import { getPrefs, savePrefs, type Prefs } from "@/lib/platform";
import { cn } from "@/lib/utils";

/**
 * Playback and notification settings.
 *
 * Saved on change rather than behind a «ذخیره» button. These are single-value
 * preferences with an immediate, visible effect, and a form that collects six
 * of them before committing is a form someone edits and then navigates away
 * from — losing the change and never knowing it.
 *
 * The notification block carries the spec's kids rule as text, because the
 * reason a parent cannot route a child's alerts to the child's device is a
 * safety decision and not an oversight: «هیچ نوتیفیکیشنی به دستگاه کودک نرود».
 */

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
const SKIPS = [10, 15, 30, 45, 60];

export default function SettingsPage() {
  const { data, error, setData } = useResource(getPrefs, "/account/settings");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  async function patch(next: Partial<Prefs>) {
    if (!data) return;
    /* Optimistic. Every field here is a toggle or a chip, and waiting a round
       trip before the chip moves makes the control feel broken. A failure
       refetches, which puts the true value back. */
    setData({ prefs: { ...data.prefs, ...next } });
    setSaving(true);
    setFailed(false);
    try {
      const fresh = await savePrefs(next);
      setData(fresh);
    } catch {
      setFailed(true);
      const fresh = await getPrefs().catch(() => null);
      if (fresh) setData(fresh);
    } finally {
      setSaving(false);
    }
  }

  if (error) return <p className="py-20 text-center text-muted">{error}</p>;
  if (!data) {
    return <Loader2 className="mx-auto mt-16 size-6 animate-spin text-muted" aria-label="بارگیری" />;
  }
  const p = data.prefs;

  return (
    <div>
      <span className="eyebrow text-muted">تنظیمات</span>
      <h1 className="mt-2 text-[27px] font-bold text-ink sm:text-[34px]">پخش و اعلان‌ها</h1>

      <p aria-live="polite" className="mt-2 h-5 text-[13px] text-faint">
        {failed ? "ذخیره نشد — دوباره تلاش کنید." : saving ? "در حال ذخیره…" : ""}
      </p>

      <section className="card mt-4 p-6">
        <h2 className="text-[17px] font-bold text-ink">پخش‌کننده</h2>
        <p className="mt-1.5 text-[14px] text-muted">
          این‌ها روی هر دستگاهی که با همین حساب وارد شود اعمال می‌شوند.
        </p>

        <Row label="سرعت پیش‌فرض">
          <Chips
            options={RATES}
            value={p.playbackRate}
            format={(v) => `${v.toLocaleString("fa-IR")}×`}
            onPick={(v) => void patch({ playbackRate: v })}
          />
        </Row>

        <Row label="پرش به جلو">
          <Chips
            options={SKIPS}
            value={p.skipForwardSec}
            format={(v) => `${v.toLocaleString("fa-IR")} ثانیه`}
            onPick={(v) => void patch({ skipForwardSec: v })}
          />
        </Row>

        <Row label="پرش به عقب">
          <Chips
            options={SKIPS}
            value={p.skipBackSec}
            format={(v) => `${v.toLocaleString("fa-IR")} ثانیه`}
            onPick={(v) => void patch({ skipBackSec: v })}
          />
        </Row>

        <Row label="فصل بعدی خودکار پخش شود">
          <Toggle
            on={p.autoplayNextChapter}
            onChange={(on) => void patch({ autoplayNextChapter: on })}
            label="پخش خودکار فصل بعد"
          />
        </Row>
      </section>

      <section className="card mt-6 p-6">
        <h2 className="text-[17px] font-bold text-ink">انتخاب نسخه</h2>
        <p className="mt-1.5 max-w-[56ch] text-[14px] leading-[1.8] text-muted">
          وقتی یک کتاب چند روایت دارد، کدام‌یک پیش‌فرض باز شود.
        </p>

        <Row label="نوع روایت">
          <Chips
            options={["any", "human", "ai"] as const}
            value={p.preferredNarrator}
            format={(v) =>
              v === "any" ? "فرقی ندارد" : v === "human" ? "گوینده انسانی" : "هوش مصنوعی"
            }
            onPick={(v) => void patch({ preferredNarrator: v })}
          />
        </Row>

        <Row label="گویش ترجیحی">
          <select
            value={p.preferredDialect ?? ""}
            onChange={(e) => void patch({ preferredDialect: e.target.value || null })}
            className="h-11 rounded-lg border border-line bg-card px-3 text-[15px] text-ink outline-none focus:border-violet-200"
            aria-label="گویش ترجیحی"
          >
            <option value="">فارسی معیار</option>
            {DIALECTS.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.title}
              </option>
            ))}
          </select>
        </Row>
      </section>

      <section className="card mt-6 p-6">
        <h2 className="text-[17px] font-bold text-ink">اعلان‌ها</h2>

        <Row label="یادآوری تمدید اشتراک">
          <Toggle
            on={p.notify.renewal}
            onChange={(on) => void patch({ notify: { ...p.notify, renewal: on } })}
            label="یادآوری تمدید"
          />
        </Row>
        <Row label="فعالیت کودک">
          <Toggle
            on={p.notify.kidsActivity}
            onChange={(on) => void patch({ notify: { ...p.notify, kidsActivity: on } })}
            label="اعلان فعالیت کودک"
          />
        </Row>
        <Row label="یادآوری برگشتن به کتاب">
          <Toggle
            on={p.notify.recap}
            onChange={(on) => void patch({ notify: { ...p.notify, recap: on } })}
            label="یادآوری ادامه‌ی کتاب"
          />
        </Row>
        <Row label="کتاب‌های تازه">
          <Toggle
            on={p.notify.newRelease}
            onChange={(on) => void patch({ notify: { ...p.notify, newRelease: on } })}
            label="اعلان کتاب تازه"
          />
        </Row>

        <p className="mt-5 rounded-lg bg-paper-2 p-4 text-[13px] leading-[1.9] text-muted">
          اعلان‌های مربوط به کودک همیشه به گوشی شما می‌رسد، نه به دستگاه کودک.
          این تنظیم‌شدنی نیست و بخشی از سیاست ایمنی کودک است.
        </p>
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 first-of-type:border-0 first-of-type:pt-0">
      <span className="text-[15px] text-ink">{label}</span>
      {children}
    </div>
  );
}

function Chips<T extends string | number>({
  options,
  value,
  format,
  onPick,
}: {
  options: readonly T[];
  value: T;
  format: (v: T) => string;
  onPick: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <button
          key={String(opt)}
          type="button"
          onClick={() => onPick(opt)}
          aria-pressed={opt === value}
          className={cn(
            "tnum cursor-pointer rounded-full border px-3.5 py-1.5 text-[14px] transition-colors",
            opt === value
              ? "border-violet-200 bg-violet-50 font-bold text-violet"
              : "border-line bg-card text-muted hover:text-ink",
          )}
        >
          {format(opt)}
        </button>
      ))}
    </div>
  );
}

/**
 * A switch, built on a real checkbox.
 *
 * The input is visually hidden rather than replaced by a div: this way the
 * control is focusable, toggles with Space, announces its state, and is
 * reachable by every assistive technology without a single ARIA attribute.
 */
function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span className="sr-only">{label}</span>
      <span
        className={cn(
          "relative h-6 w-11 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-violet-200",
          on ? "bg-violet" : "bg-paper-2",
        )}
        aria-hidden
      >
        <span
          className={cn(
            "absolute top-0.5 size-5 rounded-full bg-white shadow-e1 transition-[inset-inline-start]",
            on ? "start-0.5" : "start-[22px]",
          )}
        />
      </span>
    </label>
  );
}
