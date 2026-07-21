'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
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
  const { data, isLoading } = useQuery({ queryKey: ['bootstrap'], queryFn: api.bootstrap });

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

    return {
      loading: isLoading,
      meId: data?.me ?? null,
      role: data?.role ?? null,
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
  }, [data, isLoading]);

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider');
  return ctx;
}
