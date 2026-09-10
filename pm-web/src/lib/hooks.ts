"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, api, tokenStore } from "./api";

/**
 * The one data-fetching hook.
 *
 * No SWR, no React Query. This tool has a handful of screens, each with
 * one or two resources, and every mutation already knows which resource
 * it invalidated — a cache layer would mostly be a second source of
 * truth to keep in sync. `reload` is called explicitly after a write.
 */
interface ResourceState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

export function useResource<T>(path: string | null) {
  const [state, setState] = useState<ResourceState<T>>({
    data: null,
    error: null,
    loading: path !== null,
  });

  // Bumping this re-runs the effect. A `reload()` that called setState
  // itself would be setting state synchronously from an effect on the
  // paths that call it during render, which is the cascading-render
  // pattern React now warns about; asking for a new request and letting
  // the effect do the work keeps every write on the async side.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (path === null) return;

    // A stale response from an abandoned request must never overwrite a
    // fresh one — switching projects quickly is enough to make that
    // happen, and the symptom is a board showing another project's
    // cards.
    let cancelled = false;

    void (async () => {
      try {
        const result = await api.get<T>(path);
        if (!cancelled) setState({ data: result, error: null, loading: false });
      } catch (err) {
        if (cancelled) return;
        setState((current) => ({
          ...current,
          loading: false,
          error: err instanceof ApiError ? err.message : "خطا در دریافت اطلاعات",
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [path, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);

  return { ...state, reload };
}

/**
 * Unread-notification count over SSE.
 *
 * EventSource cannot set an Authorization header, and the usual
 * workaround — putting the token in the query string — writes a bearer
 * token into every proxy log and browser history entry. Reading the
 * stream through fetch keeps it in the header where it belongs. If the
 * stream fails for any reason the hook falls back to polling, because a
 * bell that silently stops updating is worse than one that costs a
 * request a minute.
 */
export function useUnreadCount(enabled: boolean) {
  const [unread, setUnread] = useState(0);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const poll = () => {
      if (pollTimer) return;
      pollTimer = setInterval(async () => {
        try {
          const result = await api.get<{ unread: number }>("/notifications?limit=1");
          if (!cancelled) {
            setUnread(result.unread);
            setVersion((v) => v + 1);
          }
        } catch {
          /* The next tick tries again. */
        }
      }, 30000);
    };

    const stream = async () => {
      try {
        const response = await fetch(`${api.base}/notifications/stream`, {
          headers: { Authorization: `Bearer ${tokenStore.access() ?? ""}` },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error("stream unavailable");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE frames are separated by a blank line; a partial frame
          // stays in the buffer until the rest of it arrives.
          let split: number;
          while ((split = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);

            const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
            if (!dataLine) continue;
            try {
              const payload = JSON.parse(dataLine.slice(5).trim()) as { unread: number };
              setUnread(payload.unread);
              setVersion((v) => v + 1);
            } catch {
              /* A malformed frame is skipped, not fatal. */
            }
          }
        }
        if (!cancelled) poll();
      } catch {
        if (!cancelled) poll();
      }
    };

    void stream();

    return () => {
      cancelled = true;
      controller.abort();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [enabled]);

  return { unread, version, setUnread };
}
