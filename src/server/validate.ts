import type { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  issueImportanceEnum,
  issuePriorityEnum,
  issueStatusEnum,
  issueTypeEnum,
  lifecyclePhaseEnum,
  productStatusEnum,
  releaseStatusEnum,
  requirementCategoryEnum,
  requirementStatusEnum,
  requirementTypeEnum,
  sprintStatusEnum,
  testCaseStatusEnum,
  testResultEnum,
} from '@/db/schema';
import { ApiException } from '@/lib/envelope';
import { jsonBody } from './http';

/* REST 写端点的 zod 校验层(TKT-22)。jsonBody 只保证「是合法 JSON」,这里的
   jsonBodyWith 再按 schema 做字段级校验;枚举一律取自 schema.ts 的
   pgEnum.enumValues(DB 定义是单一来源,不另抄一份)。parse 失败抛
   ApiException('VALIDATION_FAILED', 首条错误信息),由 route() 统一映射 envelope。
   zod 默认剥离未知字段,顺带挡掉批量赋值(mass assignment)。 */

export async function jsonBodyWith<S extends z.ZodType>(req: NextRequest, schema: S): Promise<z.output<S>> {
  const parsed = schema.safeParse(await jsonBody(req));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path?.length ? `${issue.path.join('.')}: ` : '';
    throw new ApiException('VALIDATION_FAILED', `${where}${issue?.message ?? '参数校验未通过'}`);
  }
  return parsed.data;
}

/* ---- shared fragments ---- */
const title = z.string().trim().min(1, '标题不能为空').max(500);
const name = z.string().trim().min(1, '名称不能为空').max(200);
const longText = z.string().max(20000).nullable().optional();
const idRef = z.string().nullable().optional();

/* 合法日期字符串(服务层 new Date() 能解析);startDate/endDate/targetDate 共用。 */
const dateString = z.string().refine((s) => !Number.isNaN(Date.parse(s)), '不是合法日期');

/* ---- issues ---- */
export const issueCreateSchema = z.object({
  title,
  key: z.string().trim().min(1).max(64).optional(),
  description: longText,
  type: z.enum(issueTypeEnum.enumValues).optional(),
  status: z.enum(issueStatusEnum.enumValues).optional(),
  priority: z.enum(issuePriorityEnum.enumValues).optional(),
  importance: z.enum(issueImportanceEnum.enumValues).optional(),
  assigneeId: idRef,
  projectId: idRef,
  requirementId: idRef,
  sprintId: idRef,
  estimate: z.number().nullable().optional(),
  storyPoints: z.number().nullable().optional(),
  labels: z.array(z.string()).optional(),
});
// key 只在创建时接受;其余字段全部可选(partial update)。
export const issueUpdateSchema = issueCreateSchema.omit({ key: true }).partial();

export const commentCreateSchema = z.object({
  body: z.string().trim().min(1, '评论内容不能为空').max(10000),
});

export const subIssueToggleSchema = z.object({
  status: z.enum(issueStatusEnum.enumValues),
});

export const issueArchiveSchema = z.object({
  archived: z.boolean().optional(),
});

/* ---- requirements ---- */
export const requirementCreateSchema = z.object({
  projectId: z.string().min(1),
  title,
  type: z.enum(requirementTypeEnum.enumValues).optional(),
  category: z.enum(requirementCategoryEnum.enumValues).nullable().optional(),
  priority: z.enum(issuePriorityEnum.enumValues).optional(),
  importance: z.enum(issueImportanceEnum.enumValues).optional(),
  status: z.enum(requirementStatusEnum.enumValues).optional(),
  description: longText,
  acceptanceCriteria: longText,
  releaseId: idRef,
  aiOwnerId: idRef,
  position: z.number().optional(),
});
export const requirementUpdateSchema = requirementCreateSchema.partial();

/* ---- test cases ---- */
export const testCaseCreateSchema = z.object({
  projectId: z.string().min(1),
  requirementId: idRef,
  title,
  priority: z.enum(issuePriorityEnum.enumValues).optional(),
  status: z.enum(testCaseStatusEnum.enumValues).optional(),
  result: z.enum(testResultEnum.enumValues).optional(),
  preconditions: longText,
  steps: longText,
  expected: longText,
  assigneeId: idRef,
  position: z.number().optional(),
});
export const testCaseUpdateSchema = testCaseCreateSchema.partial();

/* ---- catalog: product lines / products / releases ---- */
export const productLineCreateSchema = z.object({
  name,
  description: longText,
  color: z.string().max(32).optional(),
  position: z.number().optional(),
});
export const productLineUpdateSchema = productLineCreateSchema.partial();

export const productCreateSchema = z.object({
  productLineId: z.string().min(1),
  name,
  description: longText,
  icon: z.string().max(64).optional(),
  color: z.string().max(32).optional(),
  status: z.enum(productStatusEnum.enumValues).optional(),
  leadId: idRef,
  position: z.number().optional(),
});
export const productUpdateSchema = productCreateSchema.partial();

export const releaseCreateSchema = z.object({
  productId: z.string().min(1),
  name,
  description: longText,
  status: z.enum(releaseStatusEnum.enumValues).optional(),
  phase: z.enum(lifecyclePhaseEnum.enumValues).optional(),
  targetDate: dateString.nullable().optional(),
  progress: z.number().optional(),
  position: z.number().optional(),
});
export const releaseUpdateSchema = releaseCreateSchema.partial();

/* ---- sprints ---- */
export const sprintCreateSchema = z.object({
  name: z.string().trim().min(1, '迭代名称不能为空').max(200),
  goal: longText,
  status: z.enum(sprintStatusEnum.enumValues).optional(),
  startDate: dateString,
  endDate: dateString,
  capacity: z.number().nullable().optional(),
  projectIds: z.array(z.string()).optional(),
  teamId: idRef,
});
export const sprintUpdateSchema = sprintCreateSchema.partial();

export const sprintMoveIssueSchema = z.object({
  storyPoints: z.number().nullable().optional(),
});

/* ---- auth: oauth unbind ---- */
export const oauthUnbindSchema = z.object({
  provider: z.enum(['lark', 'feishu', 'github']).optional(),
});
