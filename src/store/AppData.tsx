'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, authApi } from '@/lib/api';
import type {
  CompanyRole,
  ModuleKey,
  PermLevel,
  SessionCompany,
  SessionInfo,
} from '@/lib/api';
import type {
  Member,
  Team,
  Label,
  Project,
  Sprint,
  ProductLine,
  Product,
  Release,
} from '@/lib/types';

interface AppDataValue {
  loading: boolean;
  // PLAN-5: the current user's member id (from the server, resolved via TDT).
  meId: string | null;
  role: string | null;
  /* Multi-company sandbox session (P5). */
  session: SessionInfo | null;
  sessionLoading: boolean;
  companies: SessionCompany[];
  currentCompany: SessionCompany | null;
  companyRole: CompanyRole | null;
  isPlatformAdmin: boolean;
  permissions: Partial<Record<ModuleKey, PermLevel>> | undefined;
  /* RBAC helper. Admins (session role admin / platform admin / company_admin)
     are always true. When the backend has not shipped the permissions map yet,
     fail open so the UI does not go blank mid-rollout. */
  can: (module: ModuleKey, level: 'read' | 'write') => boolean;
  members: Member[];
  teams: Team[];
  labels: Label[];
  projects: Project[];
  sprints: Sprint[];
  productLines: ProductLine[];
  products: Product[];
  releases: Release[];
  humans: Member[];
  agents: Member[];
  firstTeamId: string | null;
  me: Member | undefined;
  memberById: (id: string | null | undefined) => Member | undefined;
  teamById: (id: string | null | undefined) => Team | undefined;
  labelById: (id: string | null | undefined) => Label | undefined;
  labelByKey: (key: string) => Label | undefined;
  projectById: (id: string | null | undefined) => Project | undefined;
  sprintById: (id: string | null | undefined) => Sprint | undefined;
  productLineById: (id: string | null | undefined) => ProductLine | undefined;
  productById: (id: string | null | undefined) => Product | undefined;
  releaseById: (id: string | null | undefined) => Release | undefined;
}

const AppDataContext = createContext<AppDataValue | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { data: session, isLoading: sessionLoading } = useQuery({
    queryKey: ['session'],
    queryFn: authApi.getSession,
  });
  // 未登录（如 /login）时不拉取 bootstrap，避免 401 缓存导致登录后首屏空白；
  // 无任何公司席位（如未匹配邀请的新 OAuth 用户）时同样不拉取 —— 所有数据
  // 接口都会 403 NO_COMPANY，页面直接渲染空态，等平台管理员分配席位。
  const { data, isLoading } = useQuery({
    queryKey: ['bootstrap'],
    queryFn: api.bootstrap,
    enabled: !!session?.user && session.companies.length > 0,
  });

  const value = useMemo<AppDataValue>(() => {
    const members = data?.members ?? [];
    const teams = data?.teams ?? [];
    const labels = data?.labels ?? [];
    const projects = data?.projects ?? [];
    const sprints = data?.sprints ?? [];
    const productLines = data?.productLines ?? [];
    const products = data?.products ?? [];
    const releases = data?.releases ?? [];

    const memberMap = new Map(members.map((m) => [m.id, m]));
    const teamMap = new Map(teams.map((t) => [t.id, t]));
    const labelMap = new Map(labels.map((l) => [l.id, l]));
    const labelKeyMap = new Map(labels.filter((l) => l.key).map((l) => [l.key as string, l]));
    const projectMap = new Map(projects.map((p) => [p.id, p]));
    const sprintMap = new Map(sprints.map((s) => [s.id, s]));
    const productLineMap = new Map(productLines.map((p) => [p.id, p]));
    const productMap = new Map(products.map((p) => [p.id, p]));
    const releaseMap = new Map(releases.map((r) => [r.id, r]));

    const sessionInfo = session ?? null;
    const companyRole = sessionInfo?.companyRole ?? null;
    const isPlatformAdmin = sessionInfo?.isPlatformAdmin ?? false;
    const permissions = sessionInfo?.permissions;
    const can = (module: ModuleKey, level: 'read' | 'write'): boolean => {
      if (
        sessionInfo?.user.role === 'admin' ||
        isPlatformAdmin ||
        companyRole === 'company_admin'
      ) {
        return true;
      }
      // Backend has not shipped the permissions map yet — fail open.
      if (!permissions) return true;
      const p = permissions[module] ?? 'none';
      return level === 'write' ? p === 'write' : p !== 'none';
    };

    return {
      loading: isLoading,
      meId: data?.me ?? null,
      role: data?.role ?? null,
      session: sessionInfo,
      sessionLoading,
      companies: sessionInfo?.companies ?? [],
      currentCompany: sessionInfo?.currentCompany ?? null,
      companyRole,
      isPlatformAdmin,
      permissions,
      can,
      members,
      teams,
      labels,
      projects,
      sprints,
      productLines,
      products,
      releases,
      humans: members.filter((m) => m.type === 'human'),
      agents: members.filter((m) => m.type === 'agent'),
      firstTeamId: teams[0]?.id ?? null,
      me: data?.me ? memberMap.get(data.me) : undefined,
      memberById: (id) => (id ? memberMap.get(id) : undefined),
      teamById: (id) => (id ? teamMap.get(id) : undefined),
      labelById: (id) => (id ? labelMap.get(id) : undefined),
      labelByKey: (key) => labelKeyMap.get(key),
      projectById: (id) => (id ? projectMap.get(id) : undefined),
      sprintById: (id) => (id ? sprintMap.get(id) : undefined),
      productLineById: (id) => (id ? productLineMap.get(id) : undefined),
      productById: (id) => (id ? productMap.get(id) : undefined),
      releaseById: (id) => (id ? releaseMap.get(id) : undefined),
    };
  }, [data, isLoading, session, sessionLoading]);

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider');
  return ctx;
}
