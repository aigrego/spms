import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/* 日报模块的 React Query hooks。缓存键:
   ['reports', params] 汇总列表;['my-report', date] 我某天的日报;
   ['report-stats', today] 统计。 */

export function useReports(params?: { startDate?: string; endDate?: string; memberId?: string; productId?: string }) {
  return useQuery({
    queryKey: ['reports', params ?? {}],
    queryFn: () => api.reports(params),
  });
}

export function useMyReport(date: string | null) {
  return useQuery({
    queryKey: ['my-report', date],
    queryFn: () => api.myReport(date!),
    enabled: !!date,
  });
}

export function useReportStats(today: string) {
  return useQuery({
    queryKey: ['report-stats', today],
    queryFn: () => api.reportStats(today),
  });
}

function useInvalidateReports() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['reports'] });
    qc.invalidateQueries({ queryKey: ['my-report'] });
    qc.invalidateQueries({ queryKey: ['report-stats'] });
  };
}

export function useSaveMyReport() {
  const invalidate = useInvalidateReports();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.saveMyReport>[0]) => api.saveMyReport(input),
    onSuccess: invalidate,
  });
}

export function useDeleteReport() {
  const invalidate = useInvalidateReports();
  return useMutation({
    mutationFn: (id: string) => api.deleteReport(id),
    onSuccess: invalidate,
  });
}
