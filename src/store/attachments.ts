import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/* 设置 → 附件 面板:本公司全部附件（公司隔离与模块读闸门在服务端）。 */
export function useCompanyAttachments(enabled = true) {
  return useQuery({ queryKey: ['company-attachments'], queryFn: () => api.companyAttachments(), enabled });
}
