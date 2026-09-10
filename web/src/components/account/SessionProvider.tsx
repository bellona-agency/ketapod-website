"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { ApiError, getMe, signOut as signOutCall, type Me } from "@/lib/platform";

/**
 * Who is signed in, for the parts of the shell that are on every page.
 *
 * The header needs this and the header is rendered on public pages that are
 * statically generated. That constraint decides the whole design: the session
 * is fetched from the *browser*, after hydration, so the HTML in the CDN is the
 * same for everyone and stays cacheable. A server component reading the cookie
 * would be correct and would also turn every catalogue page dynamic — which is
 * the one thing the spec's rendering row refuses, since those pages are the
 * site's search traffic.
 *
 * `status` is three-valued rather than `me | null`, and the third value is the
 * point. Before the fetch resolves we do not know, and rendering «ورود» during
 * that moment makes the header flash "signed out" at someone who is signed in
 * on every single navigation.
 */

type Status = "loading" | "authenticated" | "anonymous";

interface SessionValue {
  me: Me | null;
  status: Status;
  /** Re-read the session — after login, after a purchase, after a top-up. */
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue>({
  me: null,
  status: "loading",
  refresh: async () => {},
  signOut: async () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  const load = useCallback(async () => {
    try {
      setMe(await getMe());
      setStatus("authenticated");
    } catch (err) {
      /* A 401 is the normal case for a visitor, not a failure. Anything else —
         the API being down, a network drop — is also treated as anonymous,
         because the alternative is a header stuck in a spinner forever. */
      if (!(err instanceof ApiError) || err.status === 401) {
        setMe(null);
      }
      setStatus("anonymous");
    }
  }, []);

  /* Written as an inline async body rather than `void load()`.
     They do the same thing, but the compiler's `set-state-in-effect` rule reads
     the call graph statically: it cannot see that every `setState` inside
     `load` is behind an `await`, so calling it directly from an effect looks
     like a synchronous cascade. The IIFE puts the awaits where the rule can see
     them, and costs a few lines of duplication to keep the check meaningful
     instead of suppressed. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await getMe();
        if (!cancelled) {
          setMe(next);
          setStatus("authenticated");
        }
      } catch {
        if (!cancelled) {
          setMe(null);
          setStatus("anonymous");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = useCallback(async () => {
    await signOutCall().catch(() => {});
    setMe(null);
    setStatus("anonymous");
    /* `replace`, not `push`: the back button must not return to a shelf that
       now belongs to nobody. The provider's own state is already cleared above,
       so the screens that read it re-render empty as they unmount. */
    router.replace("/");
  }, [router]);

  return (
    <SessionContext.Provider value={{ me, status, refresh: load, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export const useSession = () => useContext(SessionContext);
