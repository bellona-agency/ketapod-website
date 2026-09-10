"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { formatNumber, timeAgo } from "@/lib/format";
import { useUnreadCount } from "@/lib/hooks";
import type { Notification } from "@/lib/types";

import { Avatar, Spinner } from "./ui";

const kindLabels: Record<Notification["kind"], string> = {
  assigned: "واگذاری",
  mentioned: "منشن",
  commented: "کامنت",
  status_changed: "تغییر وضعیت",
  sprint_started: "شروع اسپرینت",
  due_soon: "نزدیک مهلت",
};

export function NotificationBell() {
  const { unread, version, setUnread } = useUnreadCount(true);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[] | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  // The list is fetched when the panel opens, and again whenever the
  // stream says the count moved while it is open. Streaming the
  // notifications themselves would push a payload to every idle tab for
  // a list most of them will never show.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const result = await api.get<{ items: Notification[] }>("/notifications?limit=20");
      if (!cancelled) setItems(result.items);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, version]);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!panel.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const markAllRead = async () => {
    await api.post("/notifications/read", { ids: [] });
    setUnread(0);
    setItems((current) =>
      current?.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })) ?? null,
    );
  };

  return (
    <div className="relative" ref={panel}>
      <button
        onClick={() => setOpen((value) => !value)}
        aria-label={`اعلان‌ها${unread > 0 ? `، ${unread} خوانده‌نشده` : ""}`}
        className="relative rounded-[var(--radius-input)] px-2 py-1.5 text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <span aria-hidden className="text-[15px]">
          ⌾
        </span>
        {unread > 0 && (
          <span className="absolute -top-0.5 left-0 min-w-4 rounded-full bg-accent px-1 text-[10px] font-bold leading-4 text-ground">
            {formatNumber(unread > 99 ? 99 : unread)}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-2 w-80 overflow-hidden rounded-[var(--radius-card)] border border-line-strong bg-surface shadow-2xl">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-[13px] font-bold">اعلان‌ها</span>
            {unread > 0 && (
              <button
                onClick={markAllRead}
                className="text-[12px] text-accent transition-opacity hover:opacity-80"
              >
                همه را خوانده‌شده کن
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {items === null ? (
              <div className="flex justify-center p-6 text-muted">
                <Spinner />
              </div>
            ) : items.length === 0 ? (
              <p className="p-6 text-center text-[13px] text-muted">اعلانی نداری</p>
            ) : (
              items.map((item) => {
                const body = (
                  <div
                    className={`flex gap-2.5 border-b border-line px-3 py-2.5 last:border-0 ${
                      item.readAt ? "opacity-60" : "bg-accent-dim/10"
                    }`}
                  >
                    <Avatar member={item.actor} size={22} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-ink">{item.title}</p>
                      {item.body && (
                        <p className="line-clamp-2 text-[12px] text-ink-2">{item.body}</p>
                      )}
                      <p className="mt-0.5 text-[11px] text-muted">
                        {kindLabels[item.kind]} · {timeAgo(item.createdAt)}
                      </p>
                    </div>
                  </div>
                );

                return item.issueKey ? (
                  <Link key={item.id} href={`/issue/${item.issueKey}`} onClick={() => setOpen(false)}>
                    {body}
                  </Link>
                ) : (
                  <div key={item.id}>{body}</div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
