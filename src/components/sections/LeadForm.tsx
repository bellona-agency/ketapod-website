"use client";

import { Check, ChevronDown, Loader2, PartyPopper, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AssetSlot, Float } from "@/components/primitives/AssetSlot";
import { asset } from "@/lib/assets";
import { Reveal } from "@/components/primitives/Reveal";
import { SectionHeading } from "@/components/primitives/SectionHeading";
import { Waveform } from "@/components/primitives/Waveform";
import {
  readUtm,
  submitLead,
  trackEvent,
  type LeadOptions,
} from "@/lib/api";
import { LEAD_FORM_COPY } from "@/lib/content";
import { onLeadIntent, type LeadIntent } from "@/lib/leadIntent";
import { cn, toLatinDigits } from "@/lib/utils";

type Errors = Partial<Record<string, string>>;
type Phase = "idle" | "submitting" | "success" | "duplicate" | "error";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Strips separators and converts Persian/Arabic digits the keyboard may emit. */
const normalisePhone = (v: string) => toLatinDigits(v).replace(/[\s-]/g, "");
/** Iranian mobile: 09xxxxxxxxx, +989xxxxxxxxx or 00989xxxxxxxxx. */
const PHONE_RE = /^(?:\+98|0098|0)9\d{9}$/;

/**
 * Section 12 — Lead Form.
 *
 * Client-side validation mirrors the server rules from the spec so the user
 * isn't taught them by a round trip, and 422 responses still map back onto the
 * fields. The section also listens for a preset from the Kids CTA.
 *
 * The select options arrive as a prop from the server. They used to be fetched
 * on mount, which meant the form's dropdowns were briefly populated from the
 * fallback list — on a slow API, long enough for someone to open one and pick
 * from the wrong set.
 */
export function LeadForm({ options }: { options: LeadOptions }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [errors, setErrors] = useState<Errors>({});
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const startedRef = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phoneNumber: "",
    userType: "",
    ageRange: "",
    preferredLanguage: "fa",
    interestTags: [] as string[],
    consent: false,
  });

  /**
   * Apply a preset: user type, plus a first interest if none is chosen.
   *
   * Shared by the two ways an intent can reach this form — a CTA on the same
   * page broadcasting it, and a CTA on another page having put it in the URL.
   * Both must land the reader in the same state, so both go through here.
   */
  const applyIntent = useCallback((intent: LeadIntent) => {
    setForm((f) => ({
      ...f,
      userType: intent.userType ?? f.userType,
      interestTags:
        intent.interest && f.interestTags.length === 0 ? [intent.interest] : f.interestTags,
    }));
    setPhase("idle");
    window.setTimeout(() => nameRef.current?.focus({ preventScroll: true }), 650);
  }, []);

  /* The only way an intent reaches this form. Same-page CTAs broadcast into the
     channel directly; cross-page CTAs put the intent in the URL and
     `LeadIntentFromUrl` broadcasts it on arrival. Either way the state change
     happens in this subscription callback rather than in an effect body. */
  useEffect(() => onLeadIntent(applyIntent), [applyIntent]);

  /** Fires once, on the first real interaction. */
  function markStarted(field: string) {
    if (startedRef.current) return;
    startedRef.current = true;
    trackEvent("lead_form_started", "lead-form", "form", { triggerField: field });
  }

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function toggleInterest(value: string) {
    markStarted("interestTags");
    setForm((f) => ({
      ...f,
      interestTags: f.interestTags.includes(value)
        ? f.interestTags.filter((t) => t !== value)
        : [...f.interestTags, value],
    }));
  }

  function validate(): Errors {
    const e: Errors = {};
    if (form.fullName.trim().length < 2) e.fullName = "نام و نام خانوادگی را کامل وارد کن.";
    if (!form.email && !form.phoneNumber)
      e.email = "ایمیل یا شماره موبایل — حداقل یکی لازم است.";
    if (form.email && !EMAIL_RE.test(form.email.trim()))
      e.email = "فرمت ایمیل درست نیست.";
    if (form.phoneNumber && !PHONE_RE.test(normalisePhone(form.phoneNumber)))
      e.phoneNumber = "شماره موبایل معتبر نیست.";
    if (!form.userType) e.userType = "نوع کاربر را انتخاب کن.";
    if (!form.consent) e.consent = "برای ادامه باید با شرایط موافقت کنی.";
    return e;
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (phase === "submitting") return; // no double submit

    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) {
      trackEvent("lead_form_submit_failed", "lead-form", "submit_button", {
        reason: "validation_error",
        fields: Object.keys(found),
      });
      return;
    }

    setPhase("submitting");
    setServerMessage(null);
    trackEvent("lead_form_submitted", "lead-form", "submit_button", {
      userType: form.userType,
      hasEmail: !!form.email,
      hasPhoneNumber: !!form.phoneNumber,
      interestCount: form.interestTags.length,
      preferredLanguage: form.preferredLanguage,
    });

    const result = await submitLead({
      fullName: form.fullName.trim(),
      email: form.email.trim() || undefined,
      phoneNumber: normalisePhone(form.phoneNumber) || undefined,
      userType: form.userType,
      ageRange: form.ageRange || undefined,
      interestTags: form.interestTags,
      preferredLanguage: form.preferredLanguage || undefined,
      consent: form.consent,
      source: "home",
      landingPath: window.location.pathname,
      referrer: document.referrer,
      utm: readUtm(),
    });

    if (result.status === "created") {
      trackEvent("lead_form_submit_succeeded", "lead-form", "submit_button", {
        leadId: result.leadId,
        userType: form.userType,
      });
      setPhase("success");
      setForm({
        fullName: "",
        email: "",
        phoneNumber: "",
        userType: "",
        ageRange: "",
        preferredLanguage: "fa",
        interestTags: [],
        consent: false,
      });
      return;
    }

    if (result.status === "duplicate") {
      setPhase("duplicate");
      return;
    }

    if (result.status === "validation_error") {
      setErrors(
        Object.fromEntries(
          Object.entries(result.errors).map(([k, v]) => [k, v?.[0] ?? "مقدار نامعتبر"]),
        ),
      );
      trackEvent("lead_form_submit_failed", "lead-form", "submit_button", {
        reason: "validation_error",
        fields: Object.keys(result.errors),
      });
      setPhase("idle");
      return;
    }

    trackEvent("lead_form_submit_failed", "lead-form", "submit_button", {
      reason: "server_error",
    });
    setServerMessage(result.message);
    setPhase("error");
  }

  const busy = phase === "submitting";

  return (
    <section id="lead-form" className="section-rhythm relative">
      <div className="container-k">
        <div className="relative grid overflow-hidden rounded-2xl border border-line bg-card shadow-e3 lg:grid-cols-[0.85fr_1.15fr]">
          {/* ── Pitch panel ────────────────────────────────────── */}
          <div className="relative overflow-hidden bg-violet px-5 py-10 text-white sm:px-8 md:px-10 md:py-14">
            <div aria-hidden className="pointer-events-none absolute inset-0">
              <div className="absolute -top-24 -right-16 size-[340px] rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.22)_0%,transparent_65%)]" />
              <div className="dotgrid absolute inset-0 text-white/10" />
            </div>

            <div className="relative">
              <SectionHeading
                index="10"
                eyebrow="Get Started"
                title={LEAD_FORM_COPY.title}
                lead={LEAD_FORM_COPY.subtitle}
                tone="night"
                titleClassName="text-white"
                className="[&_p]:text-white/75 [&_.eyebrow]:text-white/60"
              />

              <ul className="mt-9 flex flex-col gap-3.5">
                {[
                  "دسترسی زودهنگام به نسخه اولیه",
                  "پیشنهادهای متناسب با سلیقه‌ات",
                  "خبر انتشار محتوای کودک و بومی",
                ].map((t, i) => (
                  <Reveal
                    key={t}
                    as="li"
                    v="inline"
                    delay={0.1 * i}
                    className="flex items-center gap-3 text-[17px] text-white/90"
                  >
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-white/20">
                      <Check className="size-3.5" strokeWidth={2.5} aria-hidden />
                    </span>
                    {t}
                  </Reveal>
                ))}
              </ul>

              <Float className="mt-10 w-[190px] sm:w-[210px]" amplitude={9} duration={7}>
                <AssetSlot
                  src={asset("leadEnvelope")}
                  alt=""
                  label="پاکت نامه سه‌بعدی"
                  ratio="282 / 189"
                  tone="night"
                  rounded="rounded-2xl"
                />
              </Float>

              <Waveform
                bars={22}
                active
                seed={41}
                className="mt-6 h-10 text-white/30"
                barClassName="w-[3px]"
              />
            </div>
          </div>

          {/* ── Form panel ─────────────────────────────────────── */}
          <div className="px-4 py-9 sm:px-8 md:px-10 md:py-12">
            {/* The two terminal states and the form swap in place. This was an
                `AnimatePresence mode="wait"`; see `.kp-result-in` for what the
                swap gives up and why it does not show. */}
            {phase === "success" || phase === "duplicate" ? (
              <div
                className="kp-result-in flex min-h-[420px] flex-col items-center justify-center text-center"
                role="status"
              >
                <span
                  className={cn(
                    "kp-badge-in grid size-16 place-items-center rounded-full",
                    phase === "success"
                      ? "bg-mint-100 text-mint"
                      : "bg-amber-100 text-amber",
                  )}
                >
                  <PartyPopper className="size-7" strokeWidth={1.7} aria-hidden />
                </span>
                  <h3 className="mt-6 text-[25px] font-bold text-ink">
                    {phase === "success"
                      ? LEAD_FORM_COPY.successTitle
                      : LEAD_FORM_COPY.duplicateTitle}
                  </h3>
                  <p className="mt-2.5 max-w-[34ch] text-[17px] leading-[1.75] sm:leading-[2] text-muted">
                    {phase === "success"
                      ? LEAD_FORM_COPY.successBody
                      : LEAD_FORM_COPY.duplicateBody}
                  </p>
                  <button
                    type="button"
                    onClick={() => setPhase("idle")}
                    className="btn btn-ghost mt-8"
                  >
                    ثبت اطلاعات دیگر
                  </button>
              </div>
            ) : (
              <form
                onSubmit={handleSubmit}
                noValidate
                className="kp-form-in flex flex-col gap-5"
              >
                  <Field
                    id="fullName"
                    label="نام و نام خانوادگی"
                    required
                    error={errors.fullName}
                  >
                    <input
                      ref={nameRef}
                      id="fullName"
                      name="fullName"
                      className="field"
                      placeholder="مثلاً علی رضایی"
                      value={form.fullName}
                      aria-invalid={!!errors.fullName}
                      onFocus={() => markStarted("fullName")}
                      onChange={(e) => set("fullName", e.target.value)}
                    />
                  </Field>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field id="email" label="ایمیل" error={errors.email}>
                      <input
                        id="email"
                        name="email"
                        type="email"
                        dir="ltr"
                        className="field text-left"
                        placeholder="you@example.com"
                        value={form.email}
                        aria-invalid={!!errors.email}
                        onFocus={() => markStarted("email")}
                        onChange={(e) => set("email", e.target.value)}
                      />
                    </Field>

                    <Field id="phoneNumber" label="شماره موبایل" error={errors.phoneNumber}>
                      <input
                        id="phoneNumber"
                        name="phoneNumber"
                        type="tel"
                        dir="ltr"
                        className="field text-left"
                        placeholder="09120000000"
                        value={form.phoneNumber}
                        aria-invalid={!!errors.phoneNumber}
                        onFocus={() => markStarted("phoneNumber")}
                        onChange={(e) => set("phoneNumber", e.target.value)}
                      />
                    </Field>
                  </div>
                  <p className="-mt-3 text-[15px] text-faint">
                    پر کردن یکی از ایمیل یا شماره موبایل کافی است.
                  </p>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field id="userType" label="نوع کاربر" required error={errors.userType}>
                      <Select
                        id="userType"
                        value={form.userType}
                        invalid={!!errors.userType}
                        placeholder="انتخاب کن"
                        options={options.userTypes}
                        onFocus={() => markStarted("userType")}
                        onChange={(v) => set("userType", v)}
                      />
                    </Field>

                    <Field id="ageRange" label="بازه سنی" error={errors.ageRange}>
                      <Select
                        id="ageRange"
                        value={form.ageRange}
                        placeholder="اختیاری"
                        options={options.ageRanges}
                        onFocus={() => markStarted("ageRange")}
                        onChange={(v) => set("ageRange", v)}
                      />
                    </Field>
                  </div>

                  <Field id="preferredLanguage" label="زبان ترجیحی">
                    <Select
                      id="preferredLanguage"
                      value={form.preferredLanguage}
                      placeholder="انتخاب کن"
                      options={options.languages}
                      onFocus={() => markStarted("preferredLanguage")}
                      onChange={(v) => set("preferredLanguage", v)}
                    />
                  </Field>

                  <fieldset>
                    <legend className="mb-3 block text-[16px] font-semibold text-ink-2">
                      علاقه‌مندی‌ها
                    </legend>
                    <div className="flex flex-wrap gap-2">
                      {options.interestTags.map((tag) => {
                        const on = form.interestTags.includes(tag.value);
                        return (
                          <button
                            key={tag.value}
                            type="button"
                            onClick={() => toggleInterest(tag.value)}
                            aria-pressed={on}
                            className={cn(
                              "kp-tap flex cursor-pointer items-center gap-1.5 rounded-full border px-3.5 py-2 text-[16px]",
                              on
                                ? "border-violet bg-violet text-white"
                                : "border-line-2 text-ink-2 hover:border-violet hover:text-violet",
                            )}
                          >
                            {on && (
                              <span className="kp-check-in">
                                <Check className="size-3.5" strokeWidth={3} aria-hidden />
                              </span>
                            )}
                            {tag.label}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>

                  {/* consent */}
                  <div>
                    <label className="flex cursor-pointer items-start gap-3">
                      <span className="relative mt-0.5 flex size-5 shrink-0">
                        <input
                          type="checkbox"
                          checked={form.consent}
                          onChange={(e) => {
                            markStarted("consent");
                            set("consent", e.target.checked);
                          }}
                          className="peer absolute size-full cursor-pointer opacity-0"
                          aria-invalid={!!errors.consent}
                        />
                        <span
                          className={cn(
                            "grid size-5 place-items-center rounded-[6px] border transition-colors duration-200",
                            form.consent
                              ? "border-violet bg-violet text-white"
                              : errors.consent
                                ? "border-rose"
                                : "border-line-2",
                            "peer-focus-visible:ring-4 peer-focus-visible:ring-violet-100",
                          )}
                        >
                          {form.consent && (
                            <span className="kp-check-in">
                              <Check className="size-3" strokeWidth={3.5} aria-hidden />
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="text-[16px] leading-relaxed text-ink-2">
                        {LEAD_FORM_COPY.consent}
                      </span>
                    </label>
                    {errors.consent && <FieldError>{errors.consent}</FieldError>}
                  </div>

                  {phase === "error" && (
                    <p
                      role="alert"
                      className="kp-pop-in flex items-center gap-2 rounded-sm bg-rose-100 px-3.5 py-3 text-[16px] text-rose-ink"
                    >
                      <TriangleAlert className="size-4 shrink-0" strokeWidth={1.9} aria-hidden />
                      {serverMessage ?? LEAD_FORM_COPY.errorBody}
                    </p>
                  )}

                  {/* `.btn` already carries this page's lift-and-press. The
                      motion version was re-implementing it with different
                      numbers, which is why the submit button used to react
                      slightly differently from every other CTA. */}
                  <button
                    type="submit"
                    disabled={busy}
                    className="btn btn-violet mt-2 h-[60px] min-h-[60px] w-full text-[19px]"
                  >
                    {busy && <Loader2 className="size-4 animate-spin" strokeWidth={2.2} />}
                    {busy ? LEAD_FORM_COPY.submitting : LEAD_FORM_COPY.submit}
                  </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Field chrome ────────────────────────────────────────────────────────── */

function Field({
  id,
  label,
  required,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-[16px] font-semibold text-ink-2">
        {label}
        {required && (
          <span className="ms-1 text-violet" aria-hidden>
            *
          </span>
        )}
      </label>
      {children}
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <p className="kp-pop-in mt-1.5 text-[15px] text-rose" role="alert">
      {children}
    </p>
  );
}

function Select({
  id,
  value,
  options,
  placeholder,
  invalid,
  onChange,
  onFocus,
}: {
  id: string;
  value: string;
  options: { value: string; label: string }[];
  placeholder: string;
  invalid?: boolean;
  onChange: (v: string) => void;
  onFocus?: () => void;
}) {
  return (
    <div className="relative">
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        aria-invalid={invalid}
        className={cn(
          "field cursor-pointer appearance-none pe-10",
          !value && "text-faint",
        )}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value} className="text-ink">
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute inset-y-0 left-4 my-auto size-4 text-muted"
        strokeWidth={1.8}
        aria-hidden
      />
    </div>
  );
}
