"use client";

import { Loader2, Plus, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AVATAR_ART, AvatarBadge } from "@/components/kids/AvatarBadge";
import { ApiError, createChild, listChildren, type ChildSummary } from "@/lib/platform";

/**
 * The parent panel.
 *
 * The spec's kids section opens on the sentence the whole domain follows from:
 * «کسی که مصرف می‌کند پول نمی‌دهد و کسی که پول می‌دهد مصرف نمی‌کند». So this is
 * a separate surface from the child's, on the parent's own account, and it is
 * where every decision about the child is made — age, cap, approvals — while
 * the child's surface has no settings at all.
 */
export default function ParentPage() {
  const router = useRouter();
  const [children, setChildren] = useState<ChildSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  /* Bumped after a create, which re-runs the effect. A `load()` helper called
     from both places would setState straight from the effect body. */
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { children } = await listChildren();
        if (!cancelled) setChildren(children);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login?next=/parent");
          return;
        }
        setError("فهرست پروفایل‌ها بارگیری نشد.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, reload]);

  if (error) {
    return <main className="container-k py-20 text-center text-muted">{error}</main>;
  }

  if (!children) {
    return (
      <main className="container-k py-20">
        <Loader2 className="mx-auto size-6 animate-spin text-muted" aria-label="بارگیری" />
      </main>
    );
  }

  return (
    <main className="container-k py-10 sm:py-14">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="eyebrow text-muted">پنل والد</span>
          <h1 className="mt-2 text-[27px] font-bold text-ink sm:text-[34px]">
            پروفایل‌های کودک
          </h1>
          <p className="mt-2 max-w-[52ch] text-[16px] leading-[1.85] text-muted">
            هر کودک پروفایل خودش را دارد، ولی حساب و کیف پول یکی است — همان حساب شما.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="btn inline-flex h-11 items-center gap-2 rounded-lg bg-violet px-5 text-[15px] font-bold text-white"
        >
          <Plus className="size-4" strokeWidth={2.2} aria-hidden />
          پروفایل تازه
        </button>
      </header>

      {adding && (
        <NewChildForm
          onCreated={() => {
            setAdding(false);
            setReload((n) => n + 1);
          }}
        />
      )}

      {children.length === 0 && !adding ? (
        <p className="mt-10 rounded-lg border border-line bg-card p-6 text-[16px] leading-[1.85] text-muted">
          هنوز پروفایلی نساخته‌اید. با «پروفایل تازه» شروع کنید.
        </p>
      ) : (
        <ul className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {children.map((child) => (
            <li key={child.id}>
              <ChildCard child={child} />
            </li>
          ))}
        </ul>
      )}

      <section className="mt-12 rounded-lg border border-mint-100 bg-mint-50/60 p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-[16px] font-bold text-ink">
          <ShieldCheck className="size-4 text-mint-ink" strokeWidth={1.9} aria-hidden />
          چهار قاعده‌ای که همیشه برقرار است
        </h2>
        {/* Stated for the parent, but enforced in `lib/mock/kidsPolicy.ts`. The
            spec is explicit that these are backend policy and not a condition in
            the front end — this list is a promise the server keeps. */}
        <ul className="mt-3 grid gap-2 text-[15px] leading-[1.8] text-ink-2 sm:grid-cols-2">
          <li>· هیچ تبلیغی، در هیچ شکلی</li>
          <li>· پرسش از کتاب‌یار فقط از میان پرسش‌های آماده</li>
          <li>· فقط کتاب‌های تأییدشده، بدون محتوای کاربران غریبه</li>
          <li>· هیچ اعلانی به دستگاه کودک نمی‌رود — همه به گوشی شما</li>
        </ul>
      </section>
    </main>
  );
}

function ChildCard({ child }: { child: ChildSummary }) {
  const { screenTime: st } = child;
  const ratio =
    st.capMinutes && st.capMinutes > 0
      ? Math.min(1, st.usedMinutes / st.capMinutes)
      : 0;

  return (
    <Link
      href={`/parent/${child.id}`}
      className="group lift flex h-full flex-col gap-4 rounded-lg border border-line bg-card p-5 shadow-e1 transition-[border-color,box-shadow] hover:border-violet-200"
    >
      <div className="flex items-center gap-3">
        <AvatarBadge avatar={child.avatar} className="size-12 text-[26px]" />
        <div className="min-w-0">
          <h2 className="truncate text-[18px] font-bold text-ink">{child.name}</h2>
          <p className="tnum text-[14px] text-muted">{child.age} ساله</p>
        </div>
      </div>

      <div>
        <div className="tnum flex justify-between text-[13px] text-muted">
          <span>امروز</span>
          <span>
            {st.usedMinutes} از {st.capMinutes ?? "∞"} دقیقه
          </span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-paper-2">
          <div
            className={`h-full rounded-full ${st.exhausted ? "bg-amber-500" : "bg-mint-ink"}`}
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
      </div>

      <p className="tnum mt-auto text-[14px] text-muted">
        این هفته: {child.weekMinutes} دقیقه
      </p>
    </Link>
  );
}

function NewChildForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [age, setAge] = useState(6);
  const [cap, setCap] = useState(45);
  const [avatar, setAvatar] = useState<ChildSummary["avatar"]>("fox");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await createChild({ name, age, dailyCapMinutes: cap, avatar });
      onCreated();
    } catch (error) {
      setErr(error instanceof ApiError ? error.message : "ساخته نشد.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-6 rounded-lg border border-line bg-card p-5 sm:p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[14px] font-medium text-ink">نام</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="h-11 rounded-lg border border-line bg-paper px-3 text-[15px] text-ink outline-none focus:border-violet"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[14px] font-medium text-ink">
            سن — <span className="tnum">{age}</span> سال
          </span>
          {/* Required, not optional: the spec keys the catalogue filter and the
              assistant's safety rules off age. */}
          <input
            type="range"
            min={2}
            max={14}
            value={age}
            onChange={(e) => setAge(Number(e.target.value))}
            className="h-11"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[14px] font-medium text-ink">
            سقف روزانه — <span className="tnum">{cap}</span> دقیقه
          </span>
          <input
            type="range"
            min={10}
            max={180}
            step={5}
            value={cap}
            onChange={(e) => setCap(Number(e.target.value))}
            className="h-11"
          />
        </label>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-[14px] font-medium text-ink">شکلک</legend>
          <div className="flex gap-2">
            {(Object.keys(AVATAR_ART) as (keyof typeof AVATAR_ART)[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setAvatar(key)}
                aria-pressed={avatar === key}
                className={`grid size-11 place-items-center rounded-lg text-[22px] transition-colors ${
                  avatar === key ? "bg-violet-50 ring-2 ring-violet" : "bg-paper-2"
                }`}
              >
                {AVATAR_ART[key]}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      {err && <p className="mt-3 text-[14px] text-amber-700">{err}</p>}

      <button
        type="submit"
        disabled={busy}
        className="btn mt-5 inline-flex h-11 items-center rounded-lg bg-violet px-5 text-[15px] font-bold text-white disabled:opacity-60"
      >
        {busy ? "…" : "ساختن پروفایل"}
      </button>
    </form>
  );
}
