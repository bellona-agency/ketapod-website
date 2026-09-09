export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** mm:ss for the player. Latin digits, matching the mono numeral voice. */
export function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Two-digit section numbering used by the eyebrows: 01, 02, … */
export const pad2 = (n: number) => String(n).padStart(2, "0");

export function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Deterministic pseudo-random in [0,1) — stable placeholder art, no hydration drift. */
export function seeded(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Persian and Arabic-Indic digits, in code-point order. */
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/**
 * Normalise any Persian/Arabic digits in user input back to ASCII.
 *
 * IRANYekan renders every digit in Persian shapes, and Persian keyboards emit
 * real Persian code points — so a phone number typed on this page can arrive as
 * "۰۹۱۲…" and fail an ASCII-only pattern. Run input through this before
 * validating or submitting it.
 */
export function toLatinDigits(input: string) {
  return input.replace(/[۰-۹٠-٩]/g, (d) => {
    const fa = FA_DIGITS.indexOf(d);
    return String(fa >= 0 ? fa : AR_DIGITS.indexOf(d));
  });
}

/**
 * Make an abbreviated figure readable in Persian.
 *
 * The API hands back display strings like "20K+". With Persian numerals that
 * renders as "۲۰K+" — digits in one script, the magnitude in another. Spelling
 * the suffix out keeps the whole figure in one language.
 */
export function faFigure(display: string) {
  return display
    .replace(/(\d)\s*K\b/gi, "$1 هزار")
    .replace(/(\d)\s*M\b/gi, "$1 میلیون");
}
