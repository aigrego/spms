import { NextResponse } from 'next/server';

/* Response envelope — the single front/back contract, ported from
   packages/shared/src/envelope.ts + errors.ts (PMS subset only) and
   apps/spms-server/src/lib/response.ts.

   Per project convention: HTTP status codes only reflect transport/routing
   (401 未登录 / 403 未授权 / 500 内部错误). All business outcomes ride inside
   the envelope, by default at HTTP 200 — the frontend branches on
   `error.code`, never on text or HTTP status. */

export const ERROR_CODES = [
  // generic
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'INTERNAL',
  'CONFLICT',
  // auth / session
  'UNAUTHENTICATED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  // PMS core (PLAN-5)
  'ISSUE_NOT_FOUND',
  'SPRINT_NOT_FOUND',
  'PROJECT_NOT_FOUND',
  'TEAM_NOT_FOUND',
  'MEMBER_NOT_FOUND',
  'INVALID_TRANSITION',
  // lifecycle catalog + requirements (PLAN-5 扩展)
  'PRODUCT_LINE_NOT_FOUND',
  'PRODUCT_NOT_FOUND',
  'RELEASE_NOT_FOUND',
  'REQUIREMENT_NOT_FOUND',
  // 研发资源/虚拟团队 (PMS-2)
  'RESOURCE_NOT_FOUND',
  'RESOURCE_REVOKED',
  'LIFECYCLE_MISMATCH',
  'INVITE_FAILED',
  'TEST_CASE_NOT_FOUND',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

// Default human messages (zh-CN) — frontend may override per code.
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_FAILED: '参数校验未通过',
  NOT_FOUND: '资源不存在',
  INTERNAL: '服务内部错误',
  CONFLICT: '资源冲突',
  UNAUTHENTICATED: '未登录',
  UNAUTHORIZED: '未登录',
  FORBIDDEN: '无权访问',
  ISSUE_NOT_FOUND: 'Issue 不存在',
  SPRINT_NOT_FOUND: '迭代不存在',
  PROJECT_NOT_FOUND: '项目不存在',
  TEAM_NOT_FOUND: '团队不存在',
  MEMBER_NOT_FOUND: '成员不存在',
  INVALID_TRANSITION: '非法的状态流转',
  PRODUCT_LINE_NOT_FOUND: '产品线不存在',
  PRODUCT_NOT_FOUND: '产品不存在',
  RELEASE_NOT_FOUND: '版本不存在',
  REQUIREMENT_NOT_FOUND: '需求不存在',
  RESOURCE_NOT_FOUND: '资源不存在',
  RESOURCE_REVOKED: '该资源已被撤销',
  LIFECYCLE_MISMATCH: '生命周期归属不一致（迭代/项目/版本冲突）',
  INVITE_FAILED: '邀请失败',
  TEST_CASE_NOT_FOUND: '测试用例不存在',
};

export interface OkEnvelope<T> {
  ok: true;
  data: T;
}

export interface FailEnvelope {
  ok: false;
  error: { code: ErrorCode; message: string };
}

export type Envelope<T> = OkEnvelope<T> | FailEnvelope;

export function ok<T>(data: T, status = 200): NextResponse<OkEnvelope<T>> {
  return NextResponse.json({ ok: true, data }, { status });
}

export function fail(code: ErrorCode, message?: string, status = 200): NextResponse<FailEnvelope> {
  return NextResponse.json(
    { ok: false, error: { code, message: message ?? ERROR_MESSAGES[code] } },
    { status },
  );
}

/* Business failure thrown by services; route handlers (Phase B2) catch it and
   turn it into `fail(e.code, e.message, e.status)`. `status` defaults to 200
   (business outcome inside the envelope); auth faults pass an explicit 4xx —
   e.g. requireUser() throws ApiException('UNAUTHORIZED', ..., 401). */
export class ApiException extends Error {
  code: ErrorCode;
  status: number;
  constructor(code: ErrorCode, message?: string, status = 200) {
    super(message ?? ERROR_MESSAGES[code]);
    this.name = 'ApiException';
    this.code = code;
    this.status = status;
  }
}
