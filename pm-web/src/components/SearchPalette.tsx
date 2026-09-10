"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { api, query } from "@/lib/api";
import { typeColors, typeGlyphs } from "@/lib/format";
import type { Issue, Paginated } from "@/lib/types";

import { Modal, Spinner } from "./ui";

/**
 * Search across every project. The backend already accepts an issue key
 * in the same box as free text, so pasting "KET-142" out of a chat
 * message jumps straight to it — which is most of what this is used for.
 *
 * The caller mounts this only while it is open, so closing it throws the
 * term and the results away. Resetting them in an effect instead would
 * mean setting state from an effect on every close, for a component that
 * has no reason to exist between opens.
 */
export function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [term, setTerm] = useState("");
  const [matches, setMatches] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const router = useRouter();

  const tooShort = term.trim().length < 2;

  // Derived rather than cleared in an effect: with fewer than two
  // characters there is nothing to show, and deriving it means one less
  // state write racing the in-flight request.
  const results = tooShort ? [] : matches;

  // Debounced, because this fires a full-text query on a shared database
  // and nobody needs a request per keystroke.
  useEffect(() => {
    const trimmed = term.trim();
    if (trimmed.length < 2) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const page = await api.get<Paginated<Issue>>(`/issues${query({ q: trimmed, limit: 12 })}`);
        if (cancelled) return;
        setMatches(page.items);
        setHighlighted(0);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term]);

  const openIssue = (issue: Issue) => {
    onClose();
    router.push(`/issue/${issue.key}`);
  };

  return (
    <Modal open={open} onClose={onClose} title="جستجو" wide>
      <input
        autoFocus
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setHighlighted((index) => Math.min(index + 1, results.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlighted((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter" && results[highlighted]) {
            openIssue(results[highlighted]);
          }
        }}
        placeholder="عنوان، متن، یا کلید ایشیو مثل KET-12"
        className="w-full rounded-[var(--radius-input)] border border-line-strong bg-surface px-3 py-2.5 text-[14px] text-ink placeholder:text-muted focus:border-accent focus:outline-none"
      />

      <div className="mt-3 max-h-[50vh] overflow-y-auto">
        {loading && results.length === 0 ? (
          <div className="flex justify-center py-8 text-muted">
            <Spinner />
          </div>
        ) : results.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-muted">
            {tooShort ? "حداقل دو نویسه بنویس" : "چیزی پیدا نشد"}
          </p>
        ) : (
          results.map((issue, index) => (
            <button
              key={issue.id}
              onMouseEnter={() => setHighlighted(index)}
              onClick={() => openIssue(issue)}
              className={`flex w-full items-center gap-2.5 rounded-[var(--radius-input)] px-3 py-2 text-right transition-colors ${
                index === highlighted ? "bg-surface-2" : ""
              }`}
            >
              <span aria-hidden style={{ color: typeColors[issue.type] }}>
                {typeGlyphs[issue.type]}
              </span>
              <span className="latin w-20 shrink-0 text-[12px] text-muted">{issue.key}</span>
              <span className="min-w-0 flex-1 truncate text-[13px]">{issue.title}</span>
              <span className="shrink-0 text-[11px] text-muted">{issue.status.name}</span>
            </button>
          ))
        )}
      </div>
    </Modal>
  );
}
