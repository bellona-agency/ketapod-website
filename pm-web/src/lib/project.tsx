"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { api } from "./api";
import type { Label, Member, Project, ProjectMember, Sprint, Status } from "./types";

/**
 * Everything a project screen needs that is not the issues themselves:
 * the project, its columns, its labels, its members, its sprints.
 *
 * They are loaded once at the project layout and shared, because the
 * board, the backlog, the filters and the issue composer all need the
 * same four lists — and fetching them per screen is four extra requests
 * on every tab switch for data that changes weekly.
 */
interface ProjectValue {
  project: Project | null;
  statuses: Status[];
  labels: Label[];
  members: ProjectMember[];
  team: Member[];
  sprints: Sprint[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const ProjectContext = createContext<ProjectValue | null>(null);

export function ProjectProvider({
  projectKey,
  children,
}: {
  projectKey: string;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<Omit<ProjectValue, "reload">>({
    project: null,
    statuses: [],
    labels: [],
    members: [],
    team: [],
    sprints: [],
    loading: true,
    error: null,
  });

  // Asking for a refetch bumps a counter and lets the effect do the
  // work. A reload() that wrote state itself would be a synchronous
  // setState from inside an effect on mount, which is the cascading
  // render React now warns about.
  const [version, setVersion] = useState(0);
  const reload = useCallback(async () => {
    setVersion((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const base = `/projects/${encodeURIComponent(projectKey)}`;
      try {
        const [project, statuses, labels, members, sprints, team] = await Promise.all([
          api.get<Project>(base),
          api.get<{ items: Status[] }>(`${base}/statuses`),
          api.get<{ items: Label[] }>(`${base}/labels`),
          api.get<{ items: ProjectMember[] }>(`${base}/members`),
          api.get<{ items: Sprint[] }>(`${base}/sprints?state=active,future`),
          api.get<{ items: Member[] }>("/members"),
        ]);

        if (cancelled) return;
        setState({
          project,
          statuses: statuses.items,
          labels: labels.items,
          members: members.items,
          sprints: sprints.items,
          team: team.items,
          loading: false,
          error: null,
        });
      } catch {
        if (!cancelled) {
          setState((current) => ({ ...current, loading: false, error: "پروژه پیدا نشد" }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectKey, version]);

  const value = useMemo<ProjectValue>(() => ({ ...state, reload }), [state, reload]);
  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject(): ProjectValue {
  const value = useContext(ProjectContext);
  if (!value) throw new Error("useProject must be used inside ProjectProvider");
  return value;
}

/**
 * Assignable people for this project. Falls back to the whole team when
 * nobody has been added yet — a fresh project with an empty assignee
 * dropdown looks broken, and "add members first" is not a thing anyone
 * should have to learn before filing their first issue.
 */
export function useAssignables(): { id: string; fullName: string; avatarColor: string }[] {
  const { members, team } = useProject();
  return useMemo(
    () =>
      members.length > 0
        ? members.map((entry) => entry.member)
        : team
            .filter((member) => member.status === "active")
            .map((member) => ({
              id: member.id,
              fullName: member.fullName,
              avatarColor: member.avatarColor,
            })),
    [members, team],
  );
}
