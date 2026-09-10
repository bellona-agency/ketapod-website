/**
 * The wire types, mirroring internal/pm/model.go one-for-one.
 *
 * They are hand-written rather than generated because the pm API has no
 * OpenAPI contract — the customer API has one because three clients and
 * an outside team read it, and this one has exactly one client sitting
 * in the same repository. When that stops being true, generate them.
 */

export type Role = "owner" | "admin" | "member" | "viewer";
export type MemberStatus = "invited" | "active" | "disabled";
export type Category = "todo" | "in_progress" | "done";
export type IssueType = "epic" | "story" | "task" | "bug" | "subtask";
export type Priority = "lowest" | "low" | "medium" | "high" | "highest";
export type SprintState = "future" | "active" | "completed";

export interface Member {
  id: string;
  email: string;
  fullName: string;
  avatarColor: string;
  role: Role;
  status: MemberStatus;
  timezone: string;
  lastSeenAt?: string;
  createdAt: string;
}

export interface MemberRef {
  id: string;
  fullName: string;
  avatarColor: string;
}

export interface Project {
  id: string;
  key: string;
  name: string;
  description: string;
  color: string;
  lead?: MemberRef;
  archivedAt?: string;
  createdAt: string;
  issueCount: number;
  openCount: number;
  memberCount: number;
  activeSprint?: Sprint;
}

export interface ProjectMember {
  member: MemberRef;
  role: "lead" | "member" | "viewer";
  email: string;
}

export interface Status {
  id: string;
  projectId: string;
  name: string;
  category: Category;
  position: number;
  color: string;
  wipLimit?: number;
}

export interface Label {
  id: string;
  projectId: string;
  name: string;
  color: string;
}

export interface Sprint {
  id: string;
  projectId: string;
  name: string;
  goal: string;
  state: SprintState;
  startsAt?: string;
  endsAt?: string;
  startedAt?: string;
  completedAt?: string;
  issueCount: number;
  doneCount: number;
  points: number;
  donePoints: number;
}

export interface Issue {
  id: string;
  key: string;
  projectId: string;
  projectKey: string;
  number: number;
  type: IssueType;
  title: string;
  description?: string;
  status: Status;
  priority: Priority;
  reporter?: MemberRef;
  assignee?: MemberRef;
  parentId?: string;
  parentKey?: string;
  epicId?: string;
  epicKey?: string;
  sprintId?: string;
  storyPoints?: number;
  estimateSeconds?: number;
  spentSeconds: number;
  dueAt?: string;
  labels: Label[];
  commentCount: number;
  subtaskCount: number;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Comment {
  id: string;
  issueId: string;
  author?: MemberRef;
  body: string;
  editedAt?: string;
  createdAt: string;
}

export interface Attachment {
  id: string;
  issueId: string;
  commentId?: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  uploadedBy?: string;
  createdAt: string;
}

export interface Activity {
  id: number;
  issueId: string;
  actor?: MemberRef;
  field: string;
  oldValue?: string;
  newValue?: string;
  oldLabel?: string;
  newLabel?: string;
  createdAt: string;
}

export interface IssueLink {
  id: string;
  kind: "blocks" | "relates" | "duplicates" | "causes";
  outward: boolean;
  issueId: string;
  issueKey: string;
  title: string;
  category: Category;
}

export interface Worklog {
  id: string;
  issueId: string;
  issueKey?: string;
  member: MemberRef;
  seconds: number;
  note: string;
  startedAt: string;
  createdAt: string;
}

export interface IssueDetail extends Issue {
  comments: Comment[];
  attachments: Attachment[];
  activity: Activity[];
  links: IssueLink[];
  subtasks: Issue[];
  watchers: MemberRef[];
  worklogs: Worklog[];
}

export interface BoardColumn {
  status: Status;
  issues: Issue[];
  points: number;
}

export interface Board {
  project: Project;
  sprint?: Sprint;
  columns: BoardColumn[];
}

export interface Backlog {
  project: Project;
  sprints: Sprint[];
  issues: Issue[];
  total: number;
}

export interface Notification {
  id: string;
  kind: "assigned" | "mentioned" | "commented" | "status_changed" | "sprint_started" | "due_soon";
  issueId?: string;
  issueKey?: string;
  actor?: MemberRef;
  title: string;
  body: string;
  readAt?: string;
  createdAt: string;
}

export interface BurndownPoint {
  date: string;
  remaining: number;
  ideal: number;
  scope: number;
  completed: number;
}

export interface Burndown {
  sprint: Sprint;
  unit: string;
  points: BurndownPoint[];
}

export interface VelocityEntry {
  sprintId: string;
  sprintName: string;
  committed: number;
  completed: number;
  issuesDone: number;
  completedAt: string;
  committedCount: number;
  carriedOver: number;
}

export interface WorkloadEntry {
  member: MemberRef;
  openIssues: number;
  openPoints: number;
  inProgress: number;
  overdue: number;
  spentSeconds: number;
}

export interface CycleTime {
  medianSeconds: number;
  averageSeconds: number;
  sampleSize: number;
  sinceDays: number;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  member: Member;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
