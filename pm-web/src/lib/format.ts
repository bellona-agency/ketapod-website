/**
 * Persian formatting.
 *
 * Everything user-facing is Persian, with two deliberate exceptions that
 * both come down to copy-paste: an issue key (KET-142) and a duration
 * typed into a field stay in Latin digits, because a key with Persian
 * numerals cannot be pasted into a branch name and a duration with them
 * cannot be pasted back into the form.
 */

const dateFormatter = new Intl.DateTimeFormat("fa-IR", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const shortFormatter = new Intl.DateTimeFormat("fa-IR", { month: "short", day: "numeric" });

const dateTimeFormatter = new Intl.DateTimeFormat("fa-IR", {
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export const formatDate = (iso?: string): string => (iso ? dateFormatter.format(new Date(iso)) : "—");
export const formatShort = (iso?: string): string => (iso ? shortFormatter.format(new Date(iso)) : "—");
export const formatDateTime = (iso?: string): string =>
  iso ? dateTimeFormatter.format(new Date(iso)) : "—";

const numberFormatter = new Intl.NumberFormat("fa-IR");
export const formatNumber = (value: number): string => numberFormatter.format(value);

/**
 * Relative time, in the units people actually say. Intl.RelativeTimeFormat
 * exists but needs the unit chosen for it, and choosing badly gives
 * "۰ ساعت پیش" for something that happened a minute ago.
 */
export function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "همین حالا";
  if (seconds < 3600) return `${formatNumber(Math.floor(seconds / 60))} دقیقه پیش`;
  if (seconds < 86400) return `${formatNumber(Math.floor(seconds / 3600))} ساعت پیش`;
  if (seconds < 604800) return `${formatNumber(Math.floor(seconds / 86400))} روز پیش`;
  return formatDate(iso);
}

/** Durations read as "۲ ساعت و ۳۰ دقیقه", never as a decimal. */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "۰";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours === 0) return `${formatNumber(minutes)} دقیقه`;
  if (minutes === 0) return `${formatNumber(hours)} ساعت`;
  return `${formatNumber(hours)} ساعت و ${formatNumber(minutes)} دقیقه`;
}

/**
 * Parses what a person types into a duration field: "2h", "1h30m",
 * "45m", "۲ ساعت", or a bare number meaning minutes. Returns seconds, or
 * null when nothing sensible was typed.
 */
export function parseDuration(input: string): number | null {
  const normalized = input
    .trim()
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/ساعت/g, "h")
    .replace(/دقیقه/g, "m")
    .replace(/\s+/g, "")
    .toLowerCase();
  if (!normalized) return null;

  const pattern = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+)m)?$/.exec(normalized);
  if (pattern && (pattern[1] || pattern[2])) {
    const hours = pattern[1] ? parseFloat(pattern[1]) : 0;
    const minutes = pattern[2] ? parseInt(pattern[2], 10) : 0;
    return Math.round(hours * 3600 + minutes * 60);
  }

  const bare = /^\d+(?:\.\d+)?$/.exec(normalized);
  if (bare) return Math.round(parseFloat(bare[0]) * 60);

  return null;
}

/** Initials for an avatar. Two words give two letters, one gives one. */
export function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "؟";
  if (parts.length === 1) return parts[0].slice(0, 1);
  return parts[0].slice(0, 1) + parts[1].slice(0, 1);
}

export const priorityLabels: Record<string, string> = {
  highest: "بحرانی",
  high: "زیاد",
  medium: "متوسط",
  low: "کم",
  lowest: "خیلی کم",
};

export const typeLabels: Record<string, string> = {
  epic: "اپیک",
  story: "استوری",
  task: "تسک",
  bug: "باگ",
  subtask: "زیرتسک",
};

export const roleLabels: Record<string, string> = {
  owner: "مالک",
  admin: "مدیر",
  member: "عضو",
  viewer: "بیننده",
};

export const statusLabels: Record<string, string> = {
  invited: "دعوت‌شده",
  active: "فعال",
  disabled: "غیرفعال",
};

export const categoryLabels: Record<string, string> = {
  todo: "برای انجام",
  in_progress: "در حال انجام",
  done: "انجام‌شده",
};

export const linkLabels: Record<string, { outward: string; inward: string }> = {
  blocks: { outward: "بلاک می‌کند", inward: "بلاک شده توسط" },
  relates: { outward: "مرتبط است با", inward: "مرتبط است با" },
  duplicates: { outward: "تکراری است با", inward: "تکراری دارد" },
  causes: { outward: "باعث می‌شود", inward: "ناشی از" },
};

export const priorityColors: Record<string, string> = {
  highest: "var(--color-clay)",
  high: "var(--color-ember)",
  medium: "var(--color-ink-2)",
  low: "var(--color-muted)",
  lowest: "var(--color-muted)",
};

export const typeGlyphs: Record<string, string> = {
  epic: "◆",
  story: "▣",
  task: "▪",
  bug: "●",
  subtask: "▫",
};

export const typeColors: Record<string, string> = {
  epic: "#8A7CE0",
  story: "var(--color-leaf)",
  task: "var(--color-accent)",
  bug: "var(--color-clay)",
  subtask: "var(--color-muted)",
};

/** A date input needs yyyy-mm-dd in the Gregorian calendar, not a
    Persian-formatted string. */
export function toDateInput(iso?: string): string {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 10);
}
