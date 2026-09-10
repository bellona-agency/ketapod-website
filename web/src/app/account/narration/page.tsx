"use client";

import { FileText, Loader2, UploadCloud } from "lucide-react";
import { useState } from "react";
import { useResource } from "@/hooks/useResource";
import { VOICES, formatDate } from "@/lib/catalog";
import { ApiError, getNarrationRequests, uploadForNarration } from "@/lib/platform";
import { cn } from "@/lib/utils";

/**
 * آپلود PDF — send a document to be narrated.
 *
 * On the web because the spec routes it here and says why: «فایل آپلود می‌کند
 * یا ویرایش سنگین دارد ← وب». The mobile app records; the browser uploads.
 *
 * The progress display names the *stage* rather than showing a percentage,
 * because the nine stages are not equal in length and a bar that sits at 66%
 * for two days is worse than no bar. It also stops honestly at «بازبینی
 * انسانی» — that step needs a person, and a mock that walked past it would be
 * claiming a review that never happened.
 */
export default function NarrationPage() {
  const { data, error, reload } = useResource(getNarrationRequests, "/account/narration");

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [voiceId, setVoiceId] = useState(VOICES[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await uploadForNarration({ file, title, voiceId });
      setFile(null);
      setTitle("");
      reload();
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : "بارگذاری انجام نشد.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <span className="eyebrow text-muted">استودیو</span>
      <h1 className="mt-2 text-[27px] font-bold text-ink sm:text-[34px]">
        ارسال PDF برای گویندگی
      </h1>

      <p className="mt-3 max-w-[62ch] text-[15px] leading-[1.9] text-muted">
        فایل را بفرستید، صدا را انتخاب کنید، و مسیر تولید را دنبال کنید. خروجی
        نهایی پس از بازبینی انسانی منتشر می‌شود.
      </p>

      <form onSubmit={submit} className="card mt-7 p-6">
        <label
          htmlFor="pdf"
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors",
            file ? "border-violet-200 bg-violet-50/50" : "border-line hover:border-violet-200",
          )}
        >
          <UploadCloud className="size-8 text-violet" strokeWidth={1.5} aria-hidden />
          <span className="mt-3 text-[15px] font-medium text-ink">
            {file ? file.name : "فایل PDF را انتخاب کنید"}
          </span>
          <span className="tnum mt-1 text-[13px] text-faint">
            {file
              ? `${(file.size / 1024 / 1024).toFixed(1)} مگابایت`
              : "حداکثر ۴۰ مگابایت"}
          </span>
          <input
            id="pdf"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              const picked = e.target.files?.[0] ?? null;
              setFile(picked);
              if (picked && !title) setTitle(picked.name.replace(/\.pdf$/i, ""));
            }}
            className="sr-only"
          />
        </label>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="title" className="text-[15px] font-medium text-ink">
              عنوان
            </label>
            <input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              className="mt-2 h-11 w-full rounded-lg border border-line bg-card px-4 text-[15px] text-ink outline-none focus:border-violet-200"
            />
          </div>
          <div>
            <label htmlFor="voice" className="text-[15px] font-medium text-ink">
              گوینده
            </label>
            <select
              id="voice"
              value={voiceId}
              onChange={(e) => setVoiceId(e.target.value)}
              className="mt-2 h-11 w-full rounded-lg border border-line bg-card px-3 text-[15px] text-ink outline-none focus:border-violet-200"
            >
              {VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} — {v.timbre}
                </option>
              ))}
            </select>
          </div>
        </div>

        {failure && (
          <p role="alert" className="mt-4 text-[14px] text-red-700">
            {failure}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !file}
          className="btn mt-6 h-12 cursor-pointer rounded-lg bg-violet px-6 text-[16px] font-bold text-white disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : "ارسال به صف تولید"}
        </button>

        <p className="mt-4 rounded-lg bg-paper-2 p-4 text-[13px] leading-[1.9] text-muted">
          در این نسخه‌ی نمایشی فایل ذخیره نمی‌شود؛ فقط اندازه و نامش ثبت می‌شود
          تا مراحل تولید قابل دیدن باشد.
        </p>
      </form>

      {error && <p className="mt-6 text-[14px] text-muted">{error}</p>}

      {data && data.items.length > 0 && (
        <section className="mt-10">
          <h2 className="text-[15px] font-bold text-muted">در دست تولید</h2>
          <ul className="mt-4 flex flex-col gap-3">
            {data.items.map((r) => (
              <li key={r.id} className="rounded-lg border border-line bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[16px] font-bold text-ink">
                      <FileText className="size-4 text-violet" strokeWidth={1.9} aria-hidden />
                      {r.title}
                    </p>
                    <p className="tnum mt-1 text-[13px] text-faint">
                      {r.voiceName && <>{r.voiceName} · </>}
                      {formatDate(r.createdAt)}
                    </p>
                  </div>
                  <span className="chip chip-paper shrink-0 text-[12px]">
                    {r.status === "review" ? "بازبینی انسانی" : r.stageName}
                  </span>
                </div>

                {/* Nine ticks, one per stage. Discrete rather than a bar because
                    the stages are the thing being reported, and a smooth bar
                    would imply a rate that does not exist. */}
                <ol className="mt-4 flex gap-1" aria-label={`مرحله ${r.stage + 1} از ${r.stageCount}`}>
                  {Array.from({ length: r.stageCount }, (_, i) => (
                    <li
                      key={i}
                      className={cn(
                        "h-1.5 flex-1 rounded-full",
                        i <= r.stage ? "bg-violet" : "bg-paper-2",
                      )}
                    />
                  ))}
                </ol>
                <p className="tnum mt-2 text-[13px] text-faint">
                  مرحله {(r.stage + 1).toLocaleString("fa-IR")} از{" "}
                  {r.stageCount.toLocaleString("fa-IR")} — {r.stageName}
                </p>
                {r.note && (
                  <p className="mt-2 text-[13px] leading-[1.85] text-muted">{r.note}</p>
                )}
              </li>
            ))}
          </ul>

          <details className="mt-6 rounded-lg border border-line p-5">
            <summary className="cursor-pointer text-[14px] font-bold text-muted">
              نه مرحله‌ی تولید
            </summary>
            <ol className="mt-3 flex flex-col gap-1.5">
              {data.stages.map((s, i) => (
                <li key={s} className="tnum text-[14px] text-muted">
                  {(i + 1).toLocaleString("fa-IR")}. {s}
                </li>
              ))}
            </ol>
          </details>
        </section>
      )}
    </div>
  );
}
