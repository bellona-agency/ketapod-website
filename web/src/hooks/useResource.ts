"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/platform";

/**
 * Load one thing from the platform API, with the three behaviours every
 * authenticated screen needs and none of them worth writing twelve times.
 *
 *   * **401 bounces to login, carrying the way back.** The proxy already
 *     redirects a visitor with no cookie, but a cookie that has since been
 *     revoked gets past it — that case surfaces here, and it must not render as
 *     "بارگیری نشد" when the honest answer is "دوباره وارد شوید".
 *   * **A cancelled flag on unmount.** Navigating away mid-request otherwise
 *     sets state on a screen that no longer exists.
 *   * **`reload()` after a mutation.** Refetching rather than patching local
 *     state is the same rule the wallet already follows: the server computed
 *     the number, so the server is the one that should say what it now is.
 *
 * `load` is held in a ref, so a caller can pass an inline closure without the
 * effect re-firing on every render. The effect depends on the reload counter,
 * not on the function.
 */
export function useResource<T>(load: () => Promise<T>, nextPath: string) {
  const router = useRouter();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  /* Written in an effect, never during render — the compiler's `refs` rule, and
     the reason is real: a ref mutated in the render body is a value React may
     have produced twice and kept one of. */
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const value = await loadRef.current();
        if (!cancelled) {
          setData(value);
          setError(null);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace(`/login?next=${encodeURIComponent(nextPath)}`);
          return;
        }
        setError(err instanceof ApiError ? err.message : "بارگیری نشد.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tick, router, nextPath]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  return { data, error, reload, setData, setError };
}
