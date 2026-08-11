import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/* 团队总结的 React Query hook。缓存键 ['team-summary', params]。 */
export function useTeamSummary(params: {
  period: 'daily' | 'weekly';
  date: string;
  tzMin: number;
  memberId?: string | null;
  projectId?: string | null;
}) {
  return useQuery({
    queryKey: ['team-summary', params],
    queryFn: () =>
      api.teamSummary({
        period: params.period,
        date: params.date,
        tzMin: params.tzMin,
        memberId: params.memberId ?? undefined,
        projectId: params.projectId ?? undefined,
      }),
  });
}
