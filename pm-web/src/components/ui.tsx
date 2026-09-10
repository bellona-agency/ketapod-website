"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { initials } from "@/lib/format";

/* The shared primitives. Everything visual in the tool is built from
   these, so a change to focus rings or disabled states happens once. */

type ButtonVariant = "primary" | "ghost" | "outline" | "danger";

const buttonStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-ground hover:bg-accent/90 disabled:bg-accent-dim disabled:text-ink-2",
  ghost: "text-ink-2 hover:text-ink hover:bg-surface-2",
  outline: "border border-line-strong text-ink hover:bg-surface-2",
  danger: "border border-clay/40 text-clay hover:bg-clay/10",
};

export function Button({
  variant = "outline",
  className = "",
  loading = false,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-input)] px-3 py-1.5 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${buttonStyles[variant]} ${className}`}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

const fieldBase =
  "w-full rounded-[var(--radius-input)] border border-line-strong bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-muted focus:border-accent focus:outline-none";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${fieldBase} ${props.className ?? ""}`} />;
}

export function Textarea({
  ref,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  ref?: React.Ref<HTMLTextAreaElement>;
}) {
  return (
    <textarea
      {...props}
      ref={ref}
      className={`${fieldBase} leading-relaxed ${props.className ?? ""}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`${fieldBase} cursor-pointer appearance-none bg-[image:none] ${props.className ?? ""}`}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[12px] font-semibold text-ink-2">{label}</span>
      {children}
      {error ? (
        <span className="block text-[12px] text-clay">{error}</span>
      ) : hint ? (
        <span className="block text-[12px] text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

/**
 * An avatar is a coloured disc with initials — no image upload anywhere
 * in the tool. A five-person team recognises each other by colour
 * instantly, and an avatar uploader is a settings screen, a storage
 * path and a moderation question for no gain.
 */
export function Avatar({
  member,
  size = 24,
  title,
}: {
  member?: { fullName: string; avatarColor: string } | null;
  size?: number;
  title?: string;
}) {
  if (!member) {
    return (
      <span
        style={{ width: size, height: size, fontSize: size * 0.42 }}
        title={title ?? "بدون مسئول"}
        className="inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-line-strong text-muted"
      >
        ؟
      </span>
    );
  }
  return (
    <span
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        backgroundColor: member.avatarColor,
      }}
      title={title ?? member.fullName}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-ground"
    >
      {initials(member.fullName)}
    </span>
  );
}

export function Badge({
  children,
  color,
  className = "",
}: {
  children: ReactNode;
  color?: string;
  className?: string;
}) {
  return (
    <span
      style={color ? { borderColor: `${color}55`, color } : undefined}
      className={`inline-flex items-center gap-1 rounded-full border border-line-strong px-2 py-0.5 text-[11px] font-semibold text-ink-2 ${className}`}
    >
      {children}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[var(--radius-card)] border border-line bg-surface p-4 ${className}`}
    >
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed border-line-strong px-6 py-12 text-center">
      <p className="text-[14px] font-semibold text-ink-2">{title}</p>
      {description && <p className="max-w-sm text-[13px] text-muted">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-[var(--radius-input)] bg-clay/10 px-3 py-2 text-[13px] text-clay">
      {children}
    </p>
  );
}

/**
 * A dialog rather than a route. Every modal here interrupts something
 * the person is in the middle of — creating an issue from the board,
 * logging time on an issue they are reading — and a route change would
 * throw away the screen behind it.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // The body must not scroll behind an open dialog, or dismissing it
    // returns you somewhere else on the page.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ground/80 p-4 pt-[8vh] backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full rounded-[var(--radius-card)] border border-line-strong bg-surface shadow-2xl outline-none ${wide ? "max-w-3xl" : "max-w-lg"}`}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-[14px] font-bold">{title}</h2>
          <button
            onClick={onClose}
            aria-label="بستن"
            className="rounded p-1 text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            ✕
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-surface-2 ${className}`} />;
}
