"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";

import { ProjectProvider, useProject } from "@/lib/project";
import { Spinner } from "@/components/ui";

const tabs = [
  { slug: "board", label: "برد" },
  { slug: "backlog", label: "بک‌لاگ" },
  { slug: "issues", label: "ایشیوها" },
  { slug: "reports", label: "گزارش‌ها" },
  { slug: "settings", label: "تنظیمات" },
];

function ProjectChrome({ children }: { children: React.ReactNode }) {
  const { project, loading, error } = useProject();
  const { key } = useParams<{ key: string }>();
  const pathname = usePathname();

  if (loading && !project) {
    return (
      <div className="flex h-64 items-center justify-center text-muted">
        <Spinner />
      </div>
    );
  }
  if (error || !project) {
    return <p className="p-8 text-center text-[13px] text-clay">{error ?? "پروژه پیدا نشد"}</p>;
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="border-b border-line px-5 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <span
            aria-hidden
            className="size-2.5 rounded-full"
            style={{ backgroundColor: project.color }}
          />
          <h1 className="text-[17px] font-bold">{project.name}</h1>
          <span className="latin rounded border border-line-strong px-1.5 text-[11px] text-muted">
            {project.key}
          </span>
          {project.archivedAt && (
            <span className="rounded border border-ember/40 px-1.5 text-[11px] text-ember">
              بایگانی‌شده
            </span>
          )}
        </div>

        <nav className="-mb-px mt-3 flex gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const href = `/p/${key}/${tab.slug}`;
            const active = pathname === href;
            return (
              <Link
                key={tab.slug}
                href={href}
                className={`whitespace-nowrap border-b-2 px-3 py-2 text-[13px] transition-colors ${
                  active
                    ? "border-accent font-semibold text-ink"
                    : "border-transparent text-muted hover:text-ink-2"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const { key } = useParams<{ key: string }>();
  return (
    <ProjectProvider projectKey={key}>
      <ProjectChrome>{children}</ProjectChrome>
    </ProjectProvider>
  );
}
