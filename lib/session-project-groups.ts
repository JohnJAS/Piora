import type { SessionInfo } from "./types";

export const DEFAULT_VISIBLE_SESSION_ROOTS = 3;

export interface SessionTreeNode {
  session: SessionInfo;
  children: SessionTreeNode[];
}

export interface SessionProjectGroup {
  /** Stable project identity shared by a repository and its worktrees. */
  key: string;
  projectRoot: string;
  preferredCwd: string;
  latestModified: string | null;
  sessions: SessionInfo[];
  tree: SessionTreeNode[];
  isActiveEmptyProject: boolean;
}

export interface ActiveProject {
  cwd: string;
  projectRoot?: string | null;
}

/**
 * Build the independent-session tree used by the sidebar. Missing ancestors
 * are skipped, and malformed parent cycles safely become root conversations.
 */
export function buildSessionTree(sessions: SessionInfo[]): SessionTreeNode[] {
  const byId = new Map<string, SessionTreeNode>();
  for (const session of sessions) {
    byId.set(session.id, { session, children: [] });
  }

  const parentOf = new Map<string, string>();
  for (const session of sessions) {
    if (session.parentSessionId) parentOf.set(session.id, session.parentSessionId);
  }

  const resolveAncestor = (id: string): string | null => {
    let current = parentOf.get(id);
    const visited = new Set<string>([id]);
    let nearestExistingAncestor: string | null = null;
    while (current) {
      if (visited.has(current)) return null;
      visited.add(current);
      if (nearestExistingAncestor === null && byId.has(current)) {
        nearestExistingAncestor = current;
      }
      current = parentOf.get(current);
    }
    return nearestExistingAncestor;
  };

  const roots: SessionTreeNode[] = [];
  for (const node of byId.values()) {
    const ancestor = resolveAncestor(node.session.id);
    if (ancestor) byId.get(ancestor)!.children.push(node);
    else roots.push(node);
  }

  const latestByNode = new WeakMap<SessionTreeNode, string>();
  const latestActivity = (node: SessionTreeNode): string => {
    const cached = latestByNode.get(node);
    if (cached) return cached;
    let latest = node.session.modified;
    for (const child of node.children) {
      const childLatest = latestActivity(child);
      if (childLatest > latest) latest = childLatest;
    }
    latestByNode.set(node, latest);
    return latest;
  };
  const sortNewestFirst = (nodes: SessionTreeNode[]) => {
    nodes.sort((a, b) => latestActivity(b).localeCompare(latestActivity(a)));
    nodes.forEach((node) => sortNewestFirst(node.children));
  };
  sortNewestFirst(roots);
  return roots;
}

/**
 * Group sessions by their server-resolved project root. Opening an empty cwd
 * still creates a temporary group so the active project never disappears.
 */
export function buildSessionProjectGroups(
  sessions: SessionInfo[],
  activeProject?: ActiveProject | null,
  rememberedProjects: ActiveProject[] = [],
): SessionProjectGroup[] {
  const grouped = new Map<string, SessionInfo[]>();
  const rememberedCwdByRoot = new Map<string, string>();
  for (const session of sessions) {
    const projectRoot = session.projectRoot ?? session.cwd;
    if (!projectRoot) continue;
    const projectSessions = grouped.get(projectRoot);
    if (projectSessions) projectSessions.push(session);
    else grouped.set(projectRoot, [session]);
  }

  for (const project of rememberedProjects) {
    const projectRoot = project.projectRoot ?? project.cwd;
    if (!projectRoot) continue;
    rememberedCwdByRoot.set(projectRoot, project.cwd);
    if (!grouped.has(projectRoot)) grouped.set(projectRoot, []);
  }

  const activeRoot = activeProject
    ? (activeProject.projectRoot ?? activeProject.cwd)
    : null;
  if (activeRoot && !grouped.has(activeRoot)) grouped.set(activeRoot, []);

  const groups = [...grouped.entries()].map(([projectRoot, projectSessions]) => {
    const sessionsNewestFirst = [...projectSessions].sort((a, b) => b.modified.localeCompare(a.modified));
    const isActive = activeRoot === projectRoot;
    return {
      key: projectRoot,
      projectRoot,
      preferredCwd: isActive && activeProject
        ? activeProject.cwd
        : (sessionsNewestFirst[0]?.cwd ?? rememberedCwdByRoot.get(projectRoot) ?? projectRoot),
      latestModified: sessionsNewestFirst[0]?.modified ?? null,
      sessions: sessionsNewestFirst,
      tree: buildSessionTree(sessionsNewestFirst),
      isActiveEmptyProject: isActive && sessionsNewestFirst.length === 0,
    } satisfies SessionProjectGroup;
  });

  groups.sort((a, b) => {
    // Opening a workspace is itself recent activity, even before its first
    // session is saved, so keep that temporary active group discoverable.
    if (a.isActiveEmptyProject !== b.isActiveEmptyProject) {
      return a.isActiveEmptyProject ? -1 : 1;
    }
    return (b.latestModified ?? "").localeCompare(a.latestModified ?? "");
  });
  return groups;
}

export function sessionTreeContainsAnyId(node: SessionTreeNode, ids: ReadonlySet<string>): boolean {
  if (ids.has(node.session.id)) return true;
  return node.children.some((child) => sessionTreeContainsAnyId(child, ids));
}

/**
 * Keep the compact three-conversation view, but append any hidden root chain
 * containing the selected, running, or unread session so status is never lost.
 */
export function getVisibleSessionRoots(
  roots: SessionTreeNode[],
  expanded: boolean,
  attentionIds: ReadonlySet<string>,
  limit = DEFAULT_VISIBLE_SESSION_ROOTS,
): SessionTreeNode[] {
  if (expanded || roots.length <= limit) return roots;
  const visible = new Set(roots.slice(0, limit));
  for (const root of roots.slice(limit)) {
    if (sessionTreeContainsAnyId(root, attentionIds)) visible.add(root);
  }
  return roots.filter((root) => visible.has(root));
}

export function getProjectLabel(projectRoot: string): string {
  const withoutTrailingSeparators = projectRoot.replace(/[\\/]+$/, "");
  const parts = withoutTrailingSeparators.split(/[\\/]/);
  return parts.at(-1) || projectRoot;
}
