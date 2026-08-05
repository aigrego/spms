import type {
  IssueStatus,
  IssuePriority,
  Importance,
  IssueType,
  ProjectStatus,
  ProjectPhase,
  SprintStatus,
  ProductStatus,
  ReleaseStatus,
  RequirementType,
  RequirementCategory,
  RequirementStatus,
  TestCaseStatus,
  TestResult,
} from './types';

// PLAN-5: display labels moved to i18n (t('status.x') etc). These maps keep only
// the non-text data: colors, tones, ranks and canonical ordering.

export const STATUS: Record<IssueStatus, { color: string }> = {
  backlog: { color: '#8E99B0' },
  todo: { color: '#6E7A94' },
  in_progress: { color: '#FF8423' },
  testing: { color: '#7C5CFC' },
  done: { color: '#0063D3' },
  canceled: { color: '#8E99B0' },
};

export const STATUS_ORDER: IssueStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'testing',
  'done',
  'canceled',
];

export const PRIORITY: Record<IssuePriority, { rank: number }> = {
  urgent: { rank: 0 },
  high: { rank: 1 },
  medium: { rank: 2 },
  low: { rank: 3 },
  none: { rank: 4 },
};

export const PRIORITY_ORDER: IssuePriority[] = ['urgent', 'high', 'medium', 'low', 'none'];

// 重要度 (impact). Distinct color ramp from priority — a blue→red impact scale.
export const IMPORTANCE: Record<Importance, { rank: number; color: string }> = {
  critical: { rank: 0, color: '#D6293E' },
  high: { rank: 1, color: '#DB5A00' },
  medium: { rank: 2, color: '#0063D3' },
  low: { rank: 3, color: '#6E7A94' },
  none: { rank: 4, color: '#B4BCCC' },
};

export const IMPORTANCE_ORDER: Importance[] = ['critical', 'high', 'medium', 'low', 'none'];

// Issue 类型 — backlog (备忘) / ticket (工单) / bug (缺陷). Each carries a glyph
// color; the label lives in i18n (t('type.x')). A Bug is just an Issue of type bug.
export const ISSUE_TYPE: Record<IssueType, { color: string }> = {
  backlog: { color: '#6E56CF' },
  ticket: { color: '#0063D3' },
  bug: { color: '#D6293E' },
};

export const ISSUE_TYPE_ORDER: IssueType[] = ['backlog', 'ticket', 'bug'];

export type Tone = 'neutral' | 'blue' | 'orange' | 'success';

export const PROJECT_STATUS: Record<ProjectStatus, { tone: Tone }> = {
  backlog: { tone: 'neutral' },
  planned: { tone: 'blue' },
  in_progress: { tone: 'orange' },
  completed: { tone: 'success' },
};

export const PROJECT_STATUS_ORDER: ProjectStatus[] = ['backlog', 'planned', 'in_progress', 'completed'];

/* Product Life Cycle (PLC) phases, in lifecycle order. */
export const PROJECT_PHASE: Record<ProjectPhase, { color: string }> = {
  concept: { color: '#8E99B0' },
  development: { color: '#0063D3' },
  release: { color: '#1F9D55' },
  maintenance: { color: '#D89400' },
  retired: { color: '#6E7A94' },
};

export const PROJECT_PHASE_ORDER: ProjectPhase[] = [
  'concept',
  'development',
  'release',
  'maintenance',
  'retired',
];

export const SPRINT_STATUS: Record<SprintStatus, { tone: 'neutral' | 'orange' | 'success' }> = {
  planned: { tone: 'neutral' },
  active: { tone: 'orange' },
  completed: { tone: 'success' },
};

/* Lifecycle catalog status tones. */
export const PRODUCT_STATUS: Record<ProductStatus, { tone: Tone }> = {
  active: { tone: 'success' },
  maintenance: { tone: 'orange' },
  archived: { tone: 'neutral' },
};

export const RELEASE_STATUS: Record<ReleaseStatus, { tone: Tone; color: string }> = {
  planned: { tone: 'neutral', color: '#8E99B0' },
  in_progress: { tone: 'orange', color: '#FF8423' },
  released: { tone: 'success', color: '#1F9D55' },
  deprecated: { tone: 'neutral', color: '#6E7A94' },
};

/* Requirements / PRD. */
export const REQUIREMENT_TYPE: Record<RequirementType, { tone: Tone; color: string }> = {
  functional: { tone: 'blue', color: '#0063D3' },
  non_functional: { tone: 'orange', color: '#7A5AE0' },
};

export const REQUIREMENT_STATUS: Record<RequirementStatus, { tone: Tone }> = {
  draft: { tone: 'neutral' },
  reviewing: { tone: 'orange' },
  approved: { tone: 'blue' },
  in_dev: { tone: 'orange' },
  shipped: { tone: 'success' },
  rejected: { tone: 'neutral' },
};

export const REQUIREMENT_STATUS_ORDER: RequirementStatus[] = [
  'draft',
  'reviewing',
  'approved',
  'in_dev',
  'shipped',
  'rejected',
];

export const REQUIREMENT_CATEGORY_ORDER: RequirementCategory[] = [
  'performance',
  'security',
  'usability',
  'reliability',
  'compatibility',
  'maintainability',
];

/* Test cases. Result carries a distinct semantic color (pass=green / fail=red /
   blocked=amber / untested=slate), always paired with its label. */
type BadgeTone = 'blue' | 'orange' | 'success' | 'warning' | 'danger' | 'neutral' | 'purple';

export const TEST_CASE_STATUS: Record<TestCaseStatus, { tone: BadgeTone }> = {
  draft: { tone: 'neutral' },
  active: { tone: 'blue' },
  deprecated: { tone: 'neutral' },
};
export const TEST_CASE_STATUS_ORDER: TestCaseStatus[] = ['draft', 'active', 'deprecated'];

export const TEST_RESULT: Record<TestResult, { tone: BadgeTone; color: string }> = {
  untested: { tone: 'neutral', color: '#8E99B0' },
  passed: { tone: 'success', color: '#1F9D55' },
  failed: { tone: 'danger', color: '#D6293E' },
  blocked: { tone: 'warning', color: '#D89400' },
};
export const TEST_RESULT_ORDER: TestResult[] = ['untested', 'passed', 'failed', 'blocked'];
