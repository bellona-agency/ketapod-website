import { VOICES } from "@/lib/catalog";
import { db, notify, uid } from "@/lib/mock/db";
import { requireUser } from "@/lib/mock/session";

/**
 * آپلود PDF — submit a document to be narrated.
 *
 * The spec puts this on the web and gives the reason in the routing rule:
 * «فایل آپلود می‌کند یا ویرایش سنگین دارد ← وب». It also lays out the production
 * pipeline in nine stages, and the stages are reproduced here because the person
 * who uploaded a four-hundred-page book is entitled to know whether it is
 * waiting, being read, or sitting in review — "در حال پردازش" for two days is
 * indistinguishable from "خراب شده".
 *
 * **Nothing here stores the file.** The upload is read to measure it and then
 * discarded. This store is a demonstration of behaviour held in memory, and
 * pretending to keep a hundred megabytes of PDF in it would be the least honest
 * thing in the codebase.
 */

/** The spec's pipeline, in order. `stage` indexes into this. */
const STAGES = [
  "دریافت فایل",
  "استخراج متن",
  "پاک‌سازی و نرمال‌سازی",
  "تقسیم به فصل و جمله",
  "واژه‌نامه تلفظ",
  "سنتز صدا",
  "میکس و نرمال‌سازی صوت",
  "بازبینی انسانی",
  "بسته‌بندی و انتشار",
];

const MAX_BYTES = 40 * 1024 * 1024;

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  const items = db.narrationRequests
    .filter((r) => r.userId === auth.user.id)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .map((r) => ({
      ...r,
      stageName: STAGES[r.stage] ?? STAGES[0],
      stageCount: STAGES.length,
      voiceName: VOICES.find((v) => v.id === r.voiceId)?.name ?? null,
    }));

  return Response.json({ items, stages: STAGES });
}

export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;
  const { user } = auth;

  /* `multipart/form-data`, not JSON. A base64 PDF in a JSON body inflates by a
     third and has to be held in memory whole at both ends; multipart is what
     the platform gives us for free and what a real object-storage upload would
     use anyway. */
  const form = await req.formData().catch(() => null);
  if (!form) return Response.json({ error: "bad_form" }, { status: 400 });

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json(
      { error: "missing_file", message: "فایل PDF را انتخاب کنید." },
      { status: 422 },
    );
  }
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return Response.json(
      { error: "not_pdf", message: "فقط فایل PDF پذیرفته می‌شود." },
      { status: 415 },
    );
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: "too_large", message: "حجم فایل بیشتر از ۴۰ مگابایت است." },
      { status: 413 },
    );
  }

  const voiceId = String(form.get("voiceId") ?? "");
  if (!VOICES.some((v) => v.id === voiceId)) {
    return Response.json(
      { error: "unknown_voice", message: "گوینده را انتخاب کنید." },
      { status: 422 },
    );
  }

  const title = String(form.get("title") ?? "").trim() || file.name.replace(/\.pdf$/i, "");

  const request = {
    id: `nrq_${uid()}`,
    userId: user.id,
    title: title.slice(0, 120),
    fileName: file.name,
    sizeBytes: file.size,
    voiceId,
    stage: 0,
    status: "queued" as const,
    note: null,
    createdAt: new Date().toISOString(),
  };
  db.narrationRequests.push(request);

  /* The queue, mocked. A real deployment has a Redis job per stage and a worker
     pool; this walks the same states on a timer so the progress bar on the
     screen is showing something that genuinely moves rather than an animation.
     It stops at «بازبینی انسانی», which is where the spec puts a person — and a
     mock cannot fake a human reviewer without lying about it. */
  advance(request.id);

  return Response.json(
    { request: { ...request, stageName: STAGES[0], stageCount: STAGES.length } },
    { status: 201 },
  );
}

function advance(id: string) {
  setTimeout(() => {
    const row = db.narrationRequests.find((r) => r.id === id);
    if (!row || row.stage >= 7) return;

    row.stage += 1;
    row.status = "processing";

    if (row.stage === 7) {
      row.status = "review";
      row.note = "در صف بازبینی انسانی. این مرحله در نسخه‌ی نمایشی جلو نمی‌رود.";
      notify(
        row.userId,
        "system",
        `«${row.title}» به بازبینی رسید`,
        "پس از تأیید بازبین، نسخه‌ی صوتی منتشر می‌شود.",
        "/account/narration",
      );
      return;
    }
    advance(id);
  }, 2500);
}
