/* Helpers that shape Drizzle relational-query rows into the JSON the frontend
   consumes. Kept framework-agnostic so services/routes stay thin.

   Issues/requirements/test cases have a uuid surrogate `id` + a globally unique
   display `key` ("BUG-7" / "FR-2" / "TC-1"). The API presents `key` as the
   frontend-facing identifier, so serialize maps id ⇐ row.key. Internal uuids
   never leave the server. assignee/project/sprint/label ids are the
   members'/teams' own ids (opaque to the frontend, resolved via bootstrap maps).

   Ported from apps/spms-server/src/lib/serialize.ts (unchanged rules). */

type LabelRow = { label: { id: string } | null };
type SubRow = { status: string };

export function serializeIssueList(row: {
  id: string;
  key: string;
  teamId: string | null;
  title: string;
  description: string | null;
  type: string;
  status: string;
  priority: string;
  importance: string;
  assigneeId: string | null;
  projectId: string | null;
  requirementId: string | null;
  sprintId: string | null;
  estimate: number | null;
  storyPoints: number | null;
  backlogRank: number;
  aiAssigned: boolean;
  commentsCount: number;
  createdAt: Date;
  updatedAt: Date;
  issueLabels: LabelRow[];
  subIssues: SubRow[];
  // The requirement relation (when joined) — the frontend addresses requirements
  // by their display key, so we surface that, not the internal uuid.
  requirement?: { key: string } | null;
}) {
  const total = row.subIssues.length;
  const done = row.subIssues.filter((s) => s.status === 'done').length;
  return {
    id: row.key, // display key — the identifier the frontend uses everywhere
    teamId: row.teamId,
    title: row.title,
    description: row.description,
    type: row.type,
    status: row.status,
    priority: row.priority,
    importance: row.importance,
    assigneeId: row.assigneeId,
    projectId: row.projectId,
    // display key (FR-N / NFR-N), not the internal uuid — null when unlinked / not joined
    requirementId: row.requirement?.key ?? null,
    sprintId: row.sprintId,
    estimate: row.estimate,
    storyPoints: row.storyPoints,
    backlogRank: row.backlogRank,
    aiAssigned: row.aiAssigned,
    commentsCount: row.commentsCount,
    labels: row.issueLabels.map((il) => il.label?.id).filter(Boolean) as string[],
    sub: total > 0 ? { done, total } : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/* Requirement / PRD → frontend shape. The display `key` (functional "FR-N" /
   non-functional "NFR-N") is the identifier the frontend addresses it by (mirrors
   the issue id ⇐ key mapping). */
export function serializeRequirement(row: {
  id: string;
  key: string;
  projectId: string;
  releaseId: string | null;
  title: string;
  type: string;
  category: string | null;
  priority: string;
  importance: string;
  status: string;
  description: string | null;
  acceptanceCriteria: string | null;
  authorId: string | null;
  aiOwnerId: string | null;
  position: number;
  createdAt: Date;
  updatedAt: Date;
  issues?: { key: string; status: string }[];
}) {
  const issueKeys = (row.issues ?? []).map((i) => i.key);
  const doneCount = (row.issues ?? []).filter((i) => i.status === 'done').length;
  return {
    id: row.key,
    projectId: row.projectId,
    releaseId: row.releaseId,
    title: row.title,
    type: row.type,
    category: row.category,
    priority: row.priority,
    importance: row.importance,
    status: row.status,
    description: row.description,
    acceptanceCriteria: row.acceptanceCriteria,
    authorId: row.authorId,
    aiOwnerId: row.aiOwnerId,
    position: row.position,
    issues: issueKeys,
    issueStats: { total: issueKeys.length, done: doneCount },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/* Test case → frontend shape. Like issues, the linked requirement is surfaced by
   its display key (FR-N / NFR-N), not the internal uuid. */
export function serializeTestCase(row: {
  id: string;
  key: string;
  projectId: string;
  requirementId: string | null;
  title: string;
  priority: string;
  status: string;
  result: string;
  preconditions: string | null;
  steps: string | null;
  expected: string | null;
  authorId: string | null;
  assigneeId: string | null;
  position: number;
  createdAt: Date;
  updatedAt: Date;
  requirement?: { key: string } | null;
}) {
  return {
    id: row.key,
    projectId: row.projectId,
    requirementId: row.requirement?.key ?? null,
    title: row.title,
    priority: row.priority,
    status: row.status,
    result: row.result,
    preconditions: row.preconditions,
    steps: row.steps,
    expected: row.expected,
    authorId: row.authorId,
    assigneeId: row.assigneeId,
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function serializeAttachment(row: {
  id: string;
  url: string;
  pathname: string;
  filename: string;
  contentType: string;
  size: number;
  uploadedById: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    url: row.url,
    pathname: row.pathname,
    filename: row.filename,
    contentType: row.contentType,
    size: row.size,
    uploadedById: row.uploadedById,
    createdAt: row.createdAt,
  };
}

export function serializeIssueDetail(row: any) {
  const base = serializeIssueList(row);
  return {
    ...base,
    subIssues: (row.subIssues ?? [])
      .slice()
      .sort((a: any, b: any) => a.position - b.position)
      .map((s: any) => ({ id: s.id, title: s.title, status: s.status, position: s.position })),
    activities: (row.activities ?? [])
      .slice()
      .sort((a: any, b: any) => +new Date(a.createdAt) - +new Date(b.createdAt))
      .map((a: any) => ({
        id: a.id,
        whoId: a.whoId,
        kind: a.kind,
        body: a.body,
        createdAt: a.createdAt,
      })),
    attachments: ((row.attachments ?? []) as Parameters<typeof serializeAttachment>[0][])
      .slice()
      .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))
      .map(serializeAttachment),
  };
}
