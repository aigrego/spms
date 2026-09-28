import type { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  issueImportanceEnum,
  issuePriorityEnum,
  issueStatusEnum,
  issueTypeEnum,
  lifecyclePhaseEnum,
  planStatusEnum,
  productStatusEnum,
  projectStatusEnum,
  releaseStatusEnum,
  requirementCategoryEnum,
  requirementStatusEnum,
  requirementTypeEnum,
  sprintStatusEnum,
  testCaseCategoryEnum,
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
// force:testing → done 关单门禁的覆盖开关(关联用例未全过时强制关单)。
export const issueUpdateSchema = issueCreateSchema.omit({ key: true }).partial().extend({
  force: z.boolean().optional(),
});

export const commentCreateSchema = z.object({
  body: z.string().trim().min(1, '评论内容不能为空').max(10000),
});

export const subIssueToggleSchema = z.object({
  status: z.enum(issueStatusEnum.enumValues),
});

export const issueArchiveSchema = z.object({
  archived: z.boolean().optional(),
});

/* ---- labels ---- */
export const labelCreateSchema = z.object({
  name: z.string().trim().min(1, '标签名称不能为空').max(50),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, '颜色需为 #RRGGBB 格式'),
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
  assigneeId: idRef,
  aiOwnerId: idRef,
  position: z.number().optional(),
});
export const requirementUpdateSchema = requirementCreateSchema.partial();

/* ---- test cases ---- */
export const testCaseCreateSchema = z.object({
  projectId: z.string().min(1),
  requirementId: idRef,
  issueId: idRef,
  title,
  priority: z.enum(issuePriorityEnum.enumValues).optional(),
  category: z.enum(testCaseCategoryEnum.enumValues).optional(),
  status: z.enum(testCaseStatusEnum.enumValues).optional(),
  result: z.enum(testResultEnum.enumValues).optional(),
  preconditions: longText,
  steps: longText,
  expected: longText,
  assigneeId: idRef,
  position: z.number().optional(),
});
export const testCaseUpdateSchema = testCaseCreateSchema.partial();

/* ---- test runs (测试执行) ---- */
export const testRunCreateSchema = z
  .object({
    projectId: z.string().optional(),
    releaseId: z.string().optional(),
    category: z.enum(testCaseCategoryEnum.enumValues),
    results: z
      .array(
        z.object({
          key: z.string().min(1),
          result: z.enum(testResultEnum.enumValues),
          note: z.string().max(20000).optional(),
        }),
      )
      .min(1, 'results 不能为空'),
    note: z.string().max(20000).optional(),
    raiseBugs: z.boolean().optional(),
  })
  .refine((v) => (v.projectId ? !v.releaseId : !!v.releaseId), 'projectId 与 releaseId 必须二选一');

/* ---- dev plans (开发计划) ---- */
export const planCreateSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().trim().min(1, '标题不能为空').max(200),
  // 关联需求展示 key (FR-N / NFR-N)，最多 50 条。
  requirementIds: z.array(z.string()).max(50).optional(),
  templateMd: z.string().max(100000).optional(),
});
export const planUpdateSchema = planCreateSchema.omit({ projectId: true }).partial().extend({
  content: z.string().max(100000).optional(),
  status: z.enum(planStatusEnum.enumValues).optional(),
});

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
export const releaseUpdateSchema = releaseCreateSchema.partial().extend({
  /* 发布门禁覆盖:status='released' 时 integration 用例未全过可强制放行。 */
  force: z.boolean().optional(),
});

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

/* ---- projects ---- */
export const projectCreateSchema = z.object({
  name: z.string().trim().min(1, '项目名称不能为空').max(200),
  teamId: idRef,
  releaseId: idRef,
  status: z.enum(projectStatusEnum.enumValues).optional(),
  leadId: idRef,
  aiLeadId: idRef,
  icon: z.string().max(64).optional(),
  color: z.string().max(32).optional(),
  target: longText,
  description: longText,
  summary: longText,
  goal: longText,
  nonGoals: longText,
});
export const projectUpdateSchema = projectCreateSchema.partial();

export const projectArchiveSchema = z.object({
  archived: z.boolean().optional(),
});

/* ---- resources (研发资源池 / 席位) ---- */
/* 「至少一个认领键(email/phone/userId)」在 service 里按归一化后的值判定
   (normalizePhone 只留数字);这层先做 trim 后的粗检,消息与 service 一致。 */
export const resourceInviteSchema = z
  .object({
    name: z.string().trim().max(200).optional(),
    email: z.string().trim().max(320).optional(),
    phone: z.string().trim().max(64).optional(),
    userId: z.string().trim().max(100).optional(),
  })
  .refine((v) => !!(v.email || v.phone || v.userId), '请提供邮箱、手机号或用户 ID');

/* 公司内置角色(与 services/platform.COMPANY_ROLES 同序;validate 不反向依赖 service 层)。 */
const companyRoleValues = ['company_admin', 'product_manager', 'developer', 'tester', 'viewer'] as const;
export const companyRoleSchema = z.enum(companyRoleValues, `role 必须是内置角色之一（${companyRoleValues.join(' / ')}）`);
/* 席位(pms/seats)与平台成员(platform/companies/:id/members)改角色共用 { role }。 */
export const roleUpdateSchema = z.object({ role: companyRoleSchema });

/* ---- reports (日报) ---- */
/* 条目清洗(空内容跳过/按产品去重/产品存在性)是业务规则,留在 service;这里钉住
   日期格式、数组形状与单条长度上限(trim 后计长,与 service 口径一致;上限同
   services/reports.MAX_CONTENT_LEN)。 */
export const reportUpsertSchema = z.object({
  date: z.string('日期格式应为 YYYY-MM-DD').regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD'),
  entries: z.array(
    z.object({
      productId: z.string(),
      content: z.string().trim().max(4000, '单产品内容不能超过 4000 字'),
    }),
    '缺少日报内容',
  ),
});

/* ---- platform: companies / users / members ---- */
export const companyCreateSchema = z.object({
  key: z.string().trim().min(1, '公司 key 与名称不能为空').max(100),
  name: z.string().trim().min(1, '公司 key 与名称不能为空').max(200),
  color: z.string().max(32).nullable().optional(),
  description: longText,
});
export const companyUpdateSchema = z.object({
  name: z.string().trim().min(1, '公司名称不能为空').max(200).optional(),
  color: z.string().max(32).nullable().optional(),
  description: longText,
});

export const userCreateSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, '用户名不能为空')
    .max(100)
    .regex(/^[a-zA-Z0-9_.-]+$/, '用户名只能包含字母、数字、_ . -'),
  name: z.string().trim().max(200).optional(),
  password: z.string().min(6, '初始密码至少 6 位'),
  email: z.string().trim().max(320).optional(),
});

/* addMember 的 username 不做字符集校验(要匹配可能含其他字符的老用户名,存在性检查在 service);
   初始密码只在新用户时必填,也属 service 判定。 */
export const memberAddSchema = z.object({
  username: z.string().trim().min(1, '用户名不能为空').max(100),
  role: companyRoleSchema,
  name: z.string().trim().max(200).optional(),
  password: z.string().optional(),
  email: z.string().trim().max(320).optional(),
});

/* ---- platform: MCP API keys ---- */
/* capabilities 枚举值与 services/platform.MCP_CAPABILITIES 一致（delete 预留，
   不再提供勾选，存量令牌携 delete 不受影响）。 */
export const mcpKeyCreateSchema = z.object({
  name: z.string().trim().min(1, '名称不能为空').max(200),
  companyId: z.string().nullable().optional(),
  ownerId: z.string().optional(),
  capabilities: z
    .array(z.enum(['read', 'write'], '能力只能包含 read/write，且至少一项'))
    .min(1, '能力只能包含 read/write，且至少一项')
    .optional(),
  expiresInDays: z.number().int('有效期必须是正整数天数').min(1, '有效期必须是正整数天数').nullable().optional(),
  projectIds: z.array(z.string()).nullable().optional(),
});
export const mcpKeyUpdateSchema = z.object({
  ownerId: z.string().trim().min(1, '所属人不能为空').optional(),
  projectIds: z.array(z.string()).nullable().optional(),
});

/* ---- platform: 权限矩阵(全局默认 / 公司覆盖) ---- */
/* 矩阵完整性(4 角色 × N 模块、每格档位合法)由 service validateMatrix 复核(消息带
   role.mod 上下文);这层只钉住「对象套对象、叶子为字符串」的形状。 */
export const permissionsMatrixSchema = z.object({
  matrix: z.record(z.string(), z.record(z.string(), z.string())),
});

/* ---- platform: 公司文件存储配置(TKT-245 薄化路由) ---- */
const minioConfigSchema = z.object({
  endpoint: z.string().trim().max(500).optional(),
  port: z.number().int('端口非法').min(1, '端口非法').max(65535, '端口非法').nullable().optional(),
  useSsl: z.boolean().optional(),
  accessKey: z.string().max(200).optional(),
  secretKey: z.string().max(200).optional(),
  bucket: z.string().trim().max(200).optional(),
  publicBaseUrl: z.string().max(1000).nullable().optional(),
});
/* 保存:backend 必填。与已存配置的合并、敏感字段保留旧值、合并后端口/必填项的
   最终判定都依赖 DB 旧行,留在 service。 */
export const storageConfigSaveSchema = z.object({
  backend: z.enum(['minio', 'vercel_blob'], 'backend 必须是 minio 或 vercel_blob'),
  minio: minioConfigSchema.optional(),
  token: z.string().max(1000).optional(),
});
/* 连通性测试:backend 可省(回落已存配置的后端),action 固定 'test'。 */
export const storageConfigTestSchema = z.object({
  action: z.literal('test', '未知 action'),
  backend: z.enum(['minio', 'vercel_blob'], 'backend 必须是 minio 或 vercel_blob').optional(),
  minio: minioConfigSchema.optional(),
  token: z.string().max(1000).optional(),
});

/* ---- platform: 三方登录提供方(TKT-245 薄化路由) ---- */
export const oauthProviderSaveSchema = z.object({
  provider: z.enum(['feishu', 'lark', 'github'], '未知的登录提供方'),
  appId: z.string().trim().min(1, 'App ID 不能为空').max(200),
  appSecret: z.string().trim().max(500).optional(),
  redirectUri: z.string().max(2000).nullable().optional(),
  enabled: z.boolean().optional(),
});

/* ---- platform: Notion 连接(TKT-245 薄化路由) ---- */
/* statusMap 条目的归一化(name trim / status ?? null / sync !== false)与 projectId
   存在性检查留在 service;条目形状与 status 枚举在这里钉住(SPMS_STATUSES 与
   issueStatusEnum 同值;status 缺省即非法,消息沿用 service 文案)。 */
export const notionConnectionUpdateSchema = z.object({
  databaseId: z.string().trim().max(200).nullable().optional(),
  databaseName: z.string().trim().max(500).nullable().optional(),
  projectId: idRef,
  statusMap: z
    .array(
      z.object({
        name: z.string().trim().min(1, 'statusMap 条目缺少 name').max(200),
        status: z
          .enum(issueStatusEnum.enumValues, { error: (iss) => `statusMap 状态非法: ${String(iss.input)}` })
          .nullable(),
        sync: z.boolean().default(true),
      }),
    )
    .nullable()
    .optional(),
});

/* ---- auth: oauth unbind ---- */
export const oauthUnbindSchema = z.object({
  provider: z.enum(['lark', 'feishu', 'github']).optional(),
});
