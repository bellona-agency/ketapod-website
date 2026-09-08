"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  AlertCircle,
  AudioLines,
  BookOpen,
  Check,
  FileText,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Sparkles,
  Upload,
  Volume2,
} from "lucide-react";

import {
  AUDIO_LABEL,
  AdminError,
  DISPATCH_LABEL,
  JOB_LABEL,
  STEP_LABEL,
  adminKey,
  createIngestion,
  formatBytes,
  listIngestions,
  redispatchIngestion,
  syncIngestionAudio,
  type Ingestion,
} from "@/lib/admin";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

/**
 * The content-production panel.
 *
 * One screen, two halves: the upload form, and the list of what has been
 * uploaded with the AI pipeline's progress against each row. The progress is
 * not a local guess — it is `public.jobs` / `public.job_steps`, written by the
 * AI service into the database both sides now share, and read back through the
 * Go core. That is why a row can say "OCR, 25%" without this panel knowing
 * anything about how OCR works.
 */
export function IngestPanel() {
  const key = useSyncExternalStore(
    adminKey.subscribe,
    adminKey.get,
    adminKey.getServerSnapshot,
  );

  if (!key) return <KeyGate />;
  return <Panel onLock={adminKey.clear} />;
}

function KeyGate() {
  const [value, setValue] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = value.trim();
        if (!trimmed) return;
        /* Storing it is what unlocks the panel: the store notifies, and the
           component above re-reads. No second copy of the key in state. */
        adminKey.set(trimmed);
      }}
      className="mx-auto mt-16 w-full max-w-md rounded-2xl border border-line bg-card p-8 shadow-e3"
    >
      <h1 className="text-[22px] font-bold text-ink">پنل تولید محتوا</h1>
      <p className="mt-2 text-[15px] leading-[1.9] text-muted">
        کلید ادمین را وارد کن. تا وقتی تب باز است در همین مرورگر می‌ماند و جایی
        ذخیره یا ارسال نمی‌شود جز به API خودمان.
      </p>

      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="field mt-6 text-left"
        placeholder="ADMIN_API_KEY"
        dir="ltr"
        autoComplete="off"
      />

      <button type="submit" className="btn btn-primary mt-4 w-full">
        ورود
      </button>
    </form>
  );
}

function Panel({ onLock }: { onLock: () => void }) {
  const [items, setItems] = useState<Ingestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const { items } = await listIngestions();
      setItems(items ?? []);
      setListError("");
    } catch (err) {
      setListError(err instanceof Error ? err.message : "خطا در خواندن فهرست");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!cancelled) await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  /* Processing takes minutes and happens in another service, so the list polls
     while anything is still moving and stops when everything has settled — a
     panel left open overnight should not keep hitting the API forever. */
  const hasWorkInFlight = items.some(
    (i) =>
      i.dispatchStatus === "pending" ||
      i.audioStatus === "pending" ||
      (i.job && (i.job.status === "queued" || i.job.status === "processing")),
  );

  useEffect(() => {
    if (!hasWorkInFlight) return;
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [hasWorkInFlight, refresh]);

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">KETAPOD STUDIO</p>
          <h1 className="mt-2 text-[28px] font-bold text-ink sm:text-[32px]">
            کتاب تازه، از فایل تا صدا
          </h1>
          <p className="mt-2 max-w-[62ch] text-[15px] leading-[1.9] text-muted">
            فایل کتاب و کاور را بگذار و مشخص کن نسخه صوتی و کتاب‌یار لازم است
            یا نه. کتاب در هر حالت به کاتالوگ سایت اضافه می‌شود؛ متن‌خوانی،
            خلاصه و تولید صدا سمت سرویس هوش مصنوعی انجام می‌شود و نتیجه‌اش
            همین‌جا — و بعد در خود سایت — دیده می‌شود.
          </p>
        </div>

        <button type="button" onClick={onLock} className="btn btn-ghost">
          خروج
        </button>
      </header>

      <UploadForm onCreated={(created) => setItems((prev) => [created, ...prev])} />

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[19px] font-bold text-ink">کتاب‌های ثبت‌شده</h2>
          <button
            type="button"
            onClick={() => void refresh()}
            className="btn btn-ghost gap-2 text-[14px]"
          >
            <RefreshCw className="size-4" aria-hidden />
            به‌روزرسانی
          </button>
        </div>

        {listError && <Notice tone="error">{listError}</Notice>}

        {loading ? (
          <p className="text-[15px] text-muted">در حال خواندن…</p>
        ) : items.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line-2 p-8 text-center text-[15px] text-muted">
            هنوز کتابی ثبت نشده است.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {items.map((item) => (
              <SubmissionCard key={item.id} item={item} onChanged={refresh} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function UploadForm({ onCreated }: { onCreated: (created: Ingestion) => void }) {
  const formRef = useRef<HTMLFormElement>(null);

  const [pdf, setPdf] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [tts, setTts] = useState(true);
  const [assistant, setAssistant] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState("");
  const [done, setDone] = useState<Ingestion | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const form = new FormData(event.currentTarget);
    if (!pdf) {
      setErrors({ pdf: ["فایل PDF کتاب الزامی است"] });
      return;
    }

    setSubmitting(true);
    setErrors({});
    setMessage("");

    try {
      const created = await createIngestion({
        title: String(form.get("title") ?? ""),
        author: String(form.get("author") ?? ""),
        description: String(form.get("description") ?? ""),
        pdf,
        cover,
        tts,
        assistant,
      });

      onCreated(created);
      setDone(created);
      formRef.current?.reset();
      setPdf(null);
      setCover(null);
    } catch (err) {
      if (err instanceof AdminError) {
        setErrors(err.fields ?? {});
        setMessage(err.fields ? "" : err.message);
      } else {
        setMessage("ارسال انجام نشد. اتصال به API را بررسی کن.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="rounded-2xl border border-line bg-card p-5 shadow-e2 sm:p-8"
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <label className="flex flex-col gap-2">
          <span className="text-[15px] font-medium text-ink-2">
            عنوان کتاب <span className="text-rose-ink">*</span>
          </span>
          <input name="title" className="field" placeholder="مثلاً بوف کور" required />
          <FieldError messages={errors.title} />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-[15px] font-medium text-ink-2">نویسنده</span>
          <input name="author" className="field" placeholder="مثلاً صادق هدایت" />
        </label>
      </div>

      <label className="mt-5 flex flex-col gap-2">
        <span className="text-[15px] font-medium text-ink-2">توضیح کوتاه</span>
        <textarea
          name="description"
          rows={3}
          className="field resize-y"
          placeholder="یک پاراگراف درباره کتاب — در صفحه کتاب نمایش داده می‌شود."
        />
      </label>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <FilePicker
          label="فایل کتاب (PDF)"
          required
          accept="application/pdf"
          icon={<FileText className="size-5" aria-hidden />}
          file={pdf}
          onPick={setPdf}
          errors={errors.pdf}
        />
        <FilePicker
          label="کاور کتاب (تصویر)"
          accept="image/*"
          icon={<ImageIcon className="size-5" aria-hidden />}
          file={cover}
          onPick={setCover}
          errors={errors.cover}
        />
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Toggle
          checked={tts}
          onChange={setTts}
          icon={<Volume2 className="size-5" aria-hidden />}
          title="تولید نسخه صوتی (TTS)"
          hint="متن استخراج‌شده با گوینده هوش مصنوعی خوانده می‌شود."
        />
        <Toggle
          checked={assistant}
          onChange={setAssistant}
          icon={<Sparkles className="size-5" aria-hidden />}
          title="افزودن به چت‌بات کتاب‌یار"
          hint="کتاب به دانش کتاب‌یار اضافه می‌شود تا درباره‌اش پاسخ بدهد."
        />
      </div>

      {message && (
        <div className="mt-5">
          <Notice tone="error">{message}</Notice>
        </div>
      )}

      {done && (
        <div className="mt-5">
          <Notice tone="success">
            «{done.title}» ثبت شد و به کاتالوگ اضافه شد
            {done.catalogSlug && (
              <>
                {" — "}
                <a
                  className="underline underline-offset-4"
                  href={routes.book(done.catalogSlug)}
                  target="_blank"
                  rel="noreferrer"
                >
                  صفحه کتاب
                </a>
              </>
            )}
            .
          </Notice>
        </div>
      )}

      <div className="mt-6 flex items-center gap-4">
        <button type="submit" className="btn btn-primary gap-2" disabled={submitting}>
          {submitting ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Upload className="size-4" aria-hidden />
          )}
          {submitting ? "در حال ارسال…" : "ثبت کتاب"}
        </button>
        <p className="text-[13px] text-faint">
          آپلود کتاب‌های بزرگ ممکن است چند دقیقه طول بکشد. صفحه را نبند.
        </p>
      </div>
    </form>
  );
}

function FilePicker({
  label,
  accept,
  icon,
  file,
  onPick,
  errors,
  required = false,
}: {
  label: string;
  accept: string;
  icon: React.ReactNode;
  file: File | null;
  onPick: (file: File | null) => void;
  errors?: string[];
  required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[15px] font-medium text-ink-2">
        {label} {required && <span className="text-rose-ink">*</span>}
      </span>

      <label
        className={cn(
          "flex cursor-pointer items-center gap-3 rounded-xl border border-dashed px-4 py-4 transition-colors",
          file ? "border-violet bg-violet-50" : "border-line-2 hover:border-violet-200",
        )}
      >
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-lg", file ? "bg-violet text-white" : "bg-paper-2 text-muted")}>
          {file ? <Check className="size-5" aria-hidden /> : icon}
        </span>

        <span className="min-w-0">
          <span className="block truncate text-[15px] text-ink">
            {file ? file.name : "انتخاب فایل"}
          </span>
          <span className="block text-[13px] text-faint">
            {file ? formatBytes(file.size) : accept}
          </span>
        </span>

        <input
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
        />
      </label>

      <FieldError messages={errors} />
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  icon,
  title,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-4 transition-colors",
        checked ? "border-violet bg-violet-50" : "border-line hover:border-line-2",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 size-4 shrink-0 accent-[var(--color-violet)]"
      />
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", checked ? "bg-violet text-white" : "bg-paper-2 text-muted")}>
        {icon}
      </span>
      <span>
        <span className="block text-[15px] font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-[13px] leading-[1.8] text-muted">{hint}</span>
      </span>
    </label>
  );
}

function SubmissionCard({ item, onChanged }: { item: Ingestion; onChanged: () => void }) {
  const [busy, setBusy] = useState<"retry" | "audio" | null>(null);
  const [audioNote, setAudioNote] = useState("");

  async function retry() {
    setBusy("retry");
    try {
      await redispatchIngestion(item.id);
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function buildAudio() {
    setBusy("audio");
    setAudioNote("");
    try {
      await syncIngestionAudio(item.id);
      onChanged();
    } catch (err) {
      /* 409 is the ordinary "the narration is not ready yet" answer, not a
         failure — it is shown as a note rather than as an error state. */
      setAudioNote(err instanceof Error ? err.message : "ساخت نسخه صوتی انجام نشد");
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="rounded-2xl border border-line bg-card p-5 shadow-e1">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          {item.coverUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element -- the cover is
               served from whichever API host this build points at, and the
               panel is an internal tool: optimisation here would only add a
               remote-pattern to maintain. */
            <img
              src={item.coverUrl}
              alt=""
              className="size-16 shrink-0 rounded-lg object-cover"
            />
          ) : (
            <span className="grid size-16 shrink-0 place-items-center rounded-lg bg-paper-2 text-faint">
              <BookOpen className="size-6" aria-hidden />
            </span>
          )}

          <div className="min-w-0">
            <p className="truncate text-[17px] font-bold text-ink">{item.title}</p>
            <p className="mt-0.5 text-[14px] text-muted">
              {item.author || "بدون نویسنده"} · {item.pdfFileName} ·{" "}
              <span className="tnum">{formatBytes(item.pdfSizeBytes)}</span>
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {item.wantTts && (
                <span className={cn("chip chip-sm", item.audioStatus === "synced" && "chip-violet")}>
                  {/* A book that asked for narration is waiting for it, even if
                      it was uploaded before the audio pipeline existed and its
                      row still says "none". */}
                  {AUDIO_LABEL[item.audioStatus === "none" ? "pending" : item.audioStatus]}
                </span>
              )}
              {item.wantAssistant && <span className="chip chip-sm">کتاب‌یار</span>}
              {item.catalogSlug && (
                <a
                  href={routes.book(item.catalogSlug)}
                  target="_blank"
                  rel="noreferrer"
                  className="chip chip-sm chip-violet"
                >
                  در کاتالوگ
                </a>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <StatusBadge item={item} />

          {item.dispatchStatus === "failed" && (
            <button
              type="button"
              onClick={() => void retry()}
              className="btn btn-ghost gap-2 text-[14px]"
              disabled={busy !== null}
            >
              {busy === "retry" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="size-4" aria-hidden />
              )}
              تلاش دوباره
            </button>
          )}

          {item.wantTts && item.audioStatus !== "synced" && (
            <button
              type="button"
              onClick={() => void buildAudio()}
              className="btn btn-ghost gap-2 text-[14px]"
              disabled={busy !== null}
            >
              {busy === "audio" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <AudioLines className="size-4" aria-hidden />
              )}
              ساخت نسخه صوتی
            </button>
          )}
        </div>
      </div>

      {audioNote && (
        <p className="mt-4 rounded-lg bg-paper-2 px-3 py-2 text-[13px] leading-[1.8] text-muted">
          {audioNote}
        </p>
      )}

      {item.audioError && (
        <p className="mt-4 rounded-lg bg-rose-100 px-3 py-2 text-[13px] leading-[1.8] text-rose-ink" dir="ltr">
          {item.audioError}
        </p>
      )}

      {item.dispatchError && (
        <p className="mt-4 rounded-lg bg-rose-100 px-3 py-2 text-[13px] leading-[1.8] text-rose-ink" dir="ltr">
          {item.dispatchError}
        </p>
      )}

      {item.job?.steps && item.job.steps.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
          {item.job.steps.map((step) => (
            <li
              key={step.step}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px]",
                step.status === "completed" && "bg-mint-100 text-ink-2",
                step.status === "processing" && "bg-violet-50 text-violet-700",
                step.status === "failed" && "bg-rose-100 text-rose-ink",
                (step.status === "pending" || step.status === "skipped" || step.status === "cancelled") &&
                  "bg-paper-2 text-muted",
              )}
              title={step.error || undefined}
            >
              {step.status === "processing" && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              {step.status === "completed" && <Check className="size-3.5" aria-hidden />}
              {step.status === "failed" && <AlertCircle className="size-3.5" aria-hidden />}
              {STEP_LABEL[step.step] ?? step.step}
              {step.status === "processing" && <span className="tnum">{step.progress}%</span>}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function StatusBadge({ item }: { item: Ingestion }) {
  /* Once the narration exists the book is genuinely finished, and saying
     "processing" because some earlier step's row still says so would be the
     least useful true thing on the card. */
  if (item.audioStatus === "synced") {
    return (
      <span className="flex items-center gap-1.5 rounded-lg bg-mint-100 px-3 py-1.5 text-[13px] font-medium text-ink-2">
        <Check className="size-3.5" aria-hidden />
        در سایت قابل پخش
      </span>
    );
  }

  /* The job is the interesting state once it exists: "dispatched" only means
     the AI service accepted the request, and showing that while OCR is
     running would be the least useful true thing on the card. */
  if (item.job) {
    const tone =
      item.job.status === "failed"
        ? "bg-rose-100 text-rose-ink"
        : item.job.status === "completed"
          ? "bg-mint-100 text-ink-2"
          : "bg-violet-50 text-violet-700";

    return (
      <span className={cn("rounded-lg px-3 py-1.5 text-[13px] font-medium", tone)}>
        {JOB_LABEL[item.job.status]}
        {item.job.currentStep && item.job.status === "processing" && (
          <> · {STEP_LABEL[item.job.currentStep] ?? item.job.currentStep}</>
        )}
      </span>
    );
  }

  const tone =
    item.dispatchStatus === "failed"
      ? "bg-rose-100 text-rose-ink"
      : item.dispatchStatus === "dispatched"
        ? "bg-paper-2 text-ink-2"
        : "bg-amber-100 text-ink-2";

  return (
    <span className={cn("rounded-lg px-3 py-1.5 text-[13px] font-medium", tone)}>
      {DISPATCH_LABEL[item.dispatchStatus]}
    </span>
  );
}

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <p className="text-[13px] text-rose-ink">{messages.join(" · ")}</p>;
}

function Notice({ tone, children }: { tone: "error" | "success"; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "rounded-xl px-4 py-3 text-[14px] leading-[1.8]",
        tone === "error" ? "bg-rose-100 text-rose-ink" : "bg-mint-100 text-ink-2",
      )}
    >
      {children}
    </p>
  );
}
