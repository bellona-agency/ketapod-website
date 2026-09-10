"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { PROJECTS_CHANGED, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Project } from "@/lib/types";

import { NotificationBell } from "./NotificationBell";
import { Avatar, Spinner } from "./ui";
import { SearchPalette } from "./SearchPalette";

/**
 * The shell: a fixed sidebar of projects and a thin top bar.
 *
 * A sidebar rather than a top-level project switcher because the whole
 * team works across three or four projects at once, and a switcher makes
 * "which project am I in" a thing you have to check rather than see.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { member, loading, logout, canAdmin } = useAuth();
  const pathname = usePathname();
  const [projects, setProjects] = useState<Project[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    if (!member) return;

    const load = async () => {
      try {
        const result = await api.get<{ items: Project[] }>("/projects");
        setProjects(result.items);
      } catch {
        /* The sidebar being empty is survivable; the page below is not
           blocked on it. */
      }
    };

    void load();
    window.addEventListener(PROJECTS_CHANGED, load);
    return () => window.removeEventListener(PROJECTS_CHANGED, load);
  }, [member]);

  // Ctrl/Cmd+K opens search from anywhere. It is the one shortcut the
  // tool has, because it is the one action people take from every
  // screen.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted">
        <Spinner />
      </div>
    );
  }
  if (!member) return null;

  const activeProject = /^\/p\/([^/]+)/.exec(pathname)?.[1]?.toUpperCase();

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-l border-line bg-surface md:flex">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <span className="grid size-6 place-items-center rounded bg-accent text-[13px] font-black text-ground">
            ک
          </span>
          <span className="text-[13px] font-bold">تخته کارها</span>
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          <NavLink href="/" active={pathname === "/"}>
            کارهای من
          </NavLink>
          <NavLink href="/timesheet" active={pathname.startsWith("/timesheet")}>
            برگه زمان
          </NavLink>

          <p className="px-3 pb-1 pt-4 text-[11px] font-bold tracking-[0.14em] text-muted">
            پروژه‌ها
          </p>
          {projects.map((project) => (
            <NavLink
              key={project.id}
              href={`/p/${project.key}/board`}
              active={activeProject === project.key}
            >
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: project.color }}
              />
              <span className="truncate">{project.name}</span>
              <span className="latin mr-auto text-[11px] text-muted">{project.key}</span>
            </NavLink>
          ))}
          {projects.length === 0 && (
            <p className="px-3 py-2 text-[12px] text-muted">هنوز پروژه‌ای نیست</p>
          )}

          <div className="mt-2 border-t border-line pt-2">
            <NavLink href="/projects" active={pathname === "/projects"}>
              همه پروژه‌ها
            </NavLink>
            {canAdmin && (
              <NavLink href="/members" active={pathname.startsWith("/members")}>
                اعضای تیم
              </NavLink>
            )}
          </div>
        </nav>

        <div className="border-t border-line p-2">
          <Link
            href="/me"
            className="flex items-center gap-2 rounded-[var(--radius-input)] px-3 py-2 transition-colors hover:bg-surface-2"
          >
            <Avatar member={member} size={26} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold">{member.fullName}</span>
              <span className="block text-[11px] text-muted">تنظیمات حساب</span>
            </span>
          </Link>
          <button
            onClick={logout}
            className="w-full rounded-[var(--radius-input)] px-3 py-1.5 text-right text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-clay"
          >
            خروج
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-ground/95 px-4 py-2 backdrop-blur">
          <button
            onClick={() => setSearchOpen(true)}
            className="flex flex-1 items-center gap-2 rounded-[var(--radius-input)] border border-line-strong bg-surface px-3 py-1.5 text-right text-[13px] text-muted transition-colors hover:border-accent-dim md:max-w-md"
          >
            <span aria-hidden>⌕</span>
            <span className="flex-1">جستجو در ایشیوها…</span>
            <kbd className="latin hidden rounded border border-line-strong px-1 text-[10px] md:inline">
              ⌘K
            </kbd>
          </button>
          <NotificationBell />
        </header>

        <main className="min-w-0 flex-1">{children}</main>
      </div>

      {searchOpen && <SearchPalette open onClose={() => setSearchOpen(false)} />}
    </div>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2 rounded-[var(--radius-input)] px-3 py-1.5 text-[13px] transition-colors ${
        active ? "bg-accent-dim/40 font-semibold text-ink" : "text-ink-2 hover:bg-surface-2"
      }`}
    >
      {children}
    </Link>
  );
}
