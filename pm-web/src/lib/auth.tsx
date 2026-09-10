"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { ApiError, api, tokenStore } from "./api";
import type { Member, Tokens } from "./types";

interface AuthValue {
  member: Member | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  applyTokens: (tokens: Tokens) => void;
  refreshMember: () => Promise<void>;
  canWrite: boolean;
  canAdmin: boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

/** Pages that render without a session. Everything else redirects. */
const PUBLIC_PREFIXES = ["/login", "/invite"];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const isPublic = PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  // Bumping this re-runs the session check. Doing the work in the effect
  // rather than in a callback the effect invokes keeps every setState on
  // the far side of an await, which is what React's rule about
  // cascading renders is asking for.
  const [version, setVersion] = useState(0);
  const refreshMember = useCallback(async () => {
    setVersion((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!tokenStore.access() && !tokenStore.refresh()) {
        if (!cancelled) {
          setMember(null);
          setLoading(false);
        }
        return;
      }

      try {
        const current = await api.get<Member>("/me");
        if (!cancelled) setMember(current);
      } catch (error) {
        // A 401 here means the refresh token is gone too, so there is no
        // session to save. Any other failure — the API being down, say —
        // must not log the person out and lose their draft.
        if (error instanceof ApiError && error.status === 401) {
          tokenStore.clear();
          if (!cancelled) setMember(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [version]);

  useEffect(() => {
    if (loading || isPublic || member) return;
    // Carry where they were headed, so an expired session resumes on the
    // page they wanted rather than dropping them at the dashboard.
    const next = encodeURIComponent(pathname);
    router.replace(`/login?next=${next}`);
  }, [loading, isPublic, member, pathname, router]);

  const applyTokens = useCallback((tokens: Tokens) => {
    tokenStore.save(tokens);
    setMember(tokens.member);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      applyTokens(await api.anonymous<Tokens>("/auth/login", { email, password }));
    },
    [applyTokens],
  );

  const logout = useCallback(async () => {
    const refreshToken = tokenStore.refresh();
    try {
      if (refreshToken) await api.anonymous("/auth/logout", { refreshToken });
    } finally {
      // The local session goes regardless of what the server said: a
      // logout that fails because the network is down must still log
      // the person out of this browser.
      tokenStore.clear();
      setMember(null);
      router.replace("/login");
    }
  }, [router]);

  const value = useMemo<AuthValue>(
    () => ({
      member,
      loading,
      login,
      logout,
      applyTokens,
      refreshMember,
      canWrite: member !== null && member.role !== "viewer",
      canAdmin: member !== null && (member.role === "owner" || member.role === "admin"),
    }),
    [member, loading, login, logout, applyTokens, refreshMember],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
