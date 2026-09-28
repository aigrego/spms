import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/* 设置 → 附件 面板:本公司附件分页列表（公司隔离与模块读闸门在服务端）。
   placeholderData 保留上一页数据,翻页不闪空。 */
export function useCompanyAttachments(page = 1, pageSize = 24, enabled = true) {
  return useQuery({
    queryKey: ['company-attachments', { page, pageSize }],
    queryFn: () => api.companyAttachments({ page, pageSize }),
    enabled,
    placeholderData: keepPreviousData,
  });
}
