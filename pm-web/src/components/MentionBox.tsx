"use client";

import { useRef, useState } from "react";

import type { Member } from "@/lib/types";

import { Avatar, Textarea } from "./ui";

/**
 * A comment box with @-mentions.
 *
 * The stored form is `@[نام کامل](uuid)` rather than a bare `@name`,
 * because Persian names contain spaces — there is no way to tell where
 * a bare mention ends — and two people called «علی» would make the
 * notification a coin flip. Carrying the id also means the mention keeps
 * pointing at the right person after a rename.
 */
export function MentionBox({
  value,
  onChange,
  people,
  placeholder,
  rows = 3,
  onSubmit,
}: {
  value: string;
  onChange: (next: string) => void;
  people: Member[] | { id: string; fullName: string; avatarColor: string }[];
  placeholder?: string;
  rows?: number;
  onSubmit?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [term, setTerm] = useState<string | null>(null);
  const [anchor, setAnchor] = useState(0);

  const matches =
    term === null
      ? []
      : people
          .filter((person) => person.fullName.toLowerCase().includes(term.toLowerCase()))
          .slice(0, 6);

  const handleChange = (next: string) => {
    onChange(next);

    const caret = ref.current?.selectionStart ?? next.length;
    const before = next.slice(0, caret);
    // An @ that starts a word, followed by anything that is not a space
    // — so an email address in the middle of a sentence does not open
    // the picker.
    const found = /(?:^|\s)@([^\s@]{0,30})$/.exec(before);
    if (found) {
      setTerm(found[1]);
      setAnchor(caret - found[1].length - 1);
    } else {
      setTerm(null);
    }
  };

  const insert = (person: { id: string; fullName: string }) => {
    const caret = ref.current?.selectionStart ?? value.length;
    const next = `${value.slice(0, anchor)}@[${person.fullName}](${person.id}) ${value.slice(caret)}`;
    onChange(next);
    setTerm(null);
    requestAnimationFrame(() => ref.current?.focus());
  };

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(event) => handleChange(event.target.value)}
        onKeyDown={(event) => {
          if (term !== null && event.key === "Enter" && matches[0]) {
            event.preventDefault();
            insert(matches[0]);
            return;
          }
          if (term !== null && event.key === "Escape") {
            setTerm(null);
            return;
          }
          // Ctrl/Cmd+Enter submits, the convention everywhere else this
          // team types.
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            onSubmit?.();
          }
        }}
      />

      {matches.length > 0 && (
        <div className="absolute bottom-full right-0 z-20 mb-1 w-56 rounded-[var(--radius-input)] border border-line-strong bg-surface p-1 shadow-xl">
          {matches.map((person) => (
            <button
              key={person.id}
              type="button"
              onMouseDown={(event) => {
                // mousedown, not click: click fires after the textarea
                // has already lost focus and moved the caret.
                event.preventDefault();
                insert(person);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-right text-[13px] transition-colors hover:bg-surface-2"
            >
              <Avatar member={person} size={20} />
              {person.fullName}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Renders stored mention markup as readable text with the names
    highlighted. */
export function RichText({ body }: { body: string }) {
  const parts = body.split(/(@\[[^\]\n]{1,80}\]\([0-9a-fA-F-]{36}\))/g);
  return (
    <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink">
      {parts.map((part, index) => {
        const mention = /^@\[([^\]]+)\]\(([0-9a-fA-F-]{36})\)$/.exec(part);
        if (!mention) return <span key={index}>{part}</span>;
        return (
          <span key={index} className="rounded bg-accent-dim/40 px-1 font-semibold text-accent">
            @{mention[1]}
          </span>
        );
      })}
    </p>
  );
}
