/**
 * The API client.
 *
 * Two things here are worth more than the rest of the file. First, the
 * refresh: an access token lasts an hour and this is a tab people leave
 * open all day, so a 401 has to repair itself rather than dumping
 * someone back at the login form mid-sentence. Second, the single-flight
 * lock around it — a board screen fires five requests at once, and
 * without the lock all five would try to spend the same refresh token,
 * four of them would fail (the server rotates it on use), and the
 * session would die exactly when it was supposed to be saved.
 */

import type { Tokens } from "./types";

const BASE =
  process.env.NEXT_PUBLIC_PM_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:8090";

const API = `${BASE}/api/v1`;

const ACCESS_KEY = "pm.access";
const REFRESH_KEY = "pm.refresh";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string[]>,
  ) {
    super(message);
  }

  /** The first field-level message, which is what a form wants to show. */
  get firstFieldError(): string | undefined {
    if (!this.fields) return undefined;
    for (const messages of Object.values(this.fields)) {
      if (messages.length > 0) return messages[0];
    }
    return undefined;
  }
}

export const tokenStore = {
  access: (): string | null =>
    typeof window === "undefined" ? null : window.localStorage.getItem(ACCESS_KEY),
  refresh: (): string | null =>
    typeof window === "undefined" ? null : window.localStorage.getItem(REFRESH_KEY),
  save(tokens: Tokens) {
    window.localStorage.setItem(ACCESS_KEY, tokens.accessToken);
    window.localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
  },
  clear() {
    window.localStorage.removeItem(ACCESS_KEY);
    window.localStorage.removeItem(REFRESH_KEY);
  },
};

/** In-flight refresh, shared by every caller that hits a 401 at once. */
let refreshing: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (refreshing) return refreshing;

  refreshing = (async () => {
    const refreshToken = tokenStore.refresh();
    if (!refreshToken) return false;

    const response = await fetch(`${API}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) {
      tokenStore.clear();
      return false;
    }

    tokenStore.save((await response.json()) as Tokens);
    return true;
  })().finally(() => {
    refreshing = null;
  });

  return refreshing;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Multipart uploads set their own content type via FormData. */
  form?: FormData;
  signal?: AbortSignal;
  /** Set on the auth endpoints, which must not try to refresh a session
      that does not exist yet. */
  anonymous?: boolean;
}

async function send<T>(path: string, options: RequestOptions = {}, retry = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  if (!options.anonymous) {
    const access = tokenStore.access();
    if (access) headers.Authorization = `Bearer ${access}`;
  }

  const response = await fetch(`${API}${path}`, {
    method: options.method ?? (options.body !== undefined || options.form ? "POST" : "GET"),
    headers,
    body: options.form ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
    signal: options.signal,
  });

  if (response.status === 401 && retry && !options.anonymous) {
    if (await refreshSession()) return send<T>(path, options, false);
    throw new ApiError(401, "unauthorized", "نشست شما منقضی شده است");
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.status ?? "error",
      payload?.message ?? messageForStatus(response.status),
      payload?.errors,
    );
  }
  return payload as T;
}

function messageForStatus(status: number): string {
  switch (status) {
    case 403:
      return "دسترسی لازم را ندارید";
    case 404:
      return "پیدا نشد";
    case 409:
      return "این مقدار قبلاً استفاده شده است";
    case 422:
      return "اطلاعات واردشده معتبر نیست";
    default:
      return "خطایی رخ داد. دوباره تلاش کنید";
  }
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => send<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => send<T>(path, { method: "POST", body: body ?? {} }),
  patch: <T>(path: string, body: unknown) => send<T>(path, { method: "PATCH", body }),
  del: <T>(path: string) => send<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, form: FormData) => send<T>(path, { method: "POST", form }),
  anonymous: <T>(path: string, body: unknown) =>
    send<T>(path, { method: "POST", body, anonymous: true }),
  anonymousGet: <T>(path: string) => send<T>(path, { anonymous: true }),
  /** Absolute URL for something the browser fetches directly, such as an
      attachment opened in a new tab. */
  url: (path: string) => `${API}${path}`,
  base: API,
};

/**
 * The sidebar's project list is loaded once and lives above every screen
 * that can change it, so creating or archiving a project announces
 * itself instead of leaving a stale list until the next navigation.
 * A context would have to wrap the whole shell to do the same job.
 */
export const PROJECTS_CHANGED = "pm:projects-changed";

export function announceProjectsChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PROJECTS_CHANGED));
}

/**
 * Builds a query string, dropping empty values so the server never sees
 * `?assignee=&status=` and treats an empty string as a filter.
 */
export function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}
