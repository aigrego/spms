import { ApiException } from '@/lib/envelope';
import type { AssignmentNodeType } from '@/lib/assignments';
import type { AssignmentRole } from './services/assignments';

/* Query/body validators shared by the assignments route family (kept out of
   route.ts files — Next only allows HTTP-method exports there). */

const NODE_TYPES: readonly AssignmentNodeType[] = ['product', 'release', 'project', 'sprint'];
const ROLES: readonly AssignmentRole[] = ['lead', 'member'];

export function asNodeType(v: string | null | undefined): AssignmentNodeType {
  if (v && (NODE_TYPES as readonly string[]).includes(v)) return v as AssignmentNodeType;
  throw new ApiException('VALIDATION_FAILED', 'nodeType 必须是 product/release/project/sprint');
}

export function asRole(v: string | null | undefined): AssignmentRole {
  if (v && (ROLES as readonly string[]).includes(v)) return v as AssignmentRole;
  throw new ApiException('VALIDATION_FAILED', 'role 必须是 lead/member');
}

export function requiredParam(v: string | null | undefined, name: string): string {
  if (!v) throw new ApiException('VALIDATION_FAILED', `${name} 必填`);
  return v;
}
