import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ProductInput, ReleaseInput } from '@/lib/api';

/* Lifecycle catalog mutations (产品线 → 产品 → 版本/Release). The catalog ships
   in the bootstrap payload, so every mutation invalidates ['bootstrap']. */

function useInvalidateCatalog() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['bootstrap'] });
}

export function useCreateProductLine() {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: (input: { name: string; description?: string | null; color?: string }) =>
      api.createProductLine(input),
    onSuccess: invalidate,
  });
}

export function useUpdateProductLine() {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: { name?: string; description?: string | null; color?: string } }) =>
      api.updateProductLine(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteProductLine() {
  const invalidate = useInvalidateCatalog();
  return useMutation({ mutationFn: (id: string) => api.deleteProductLine(id), onSuccess: invalidate });
}

export function useCreateProduct() {
  const invalidate = useInvalidateCatalog();
  return useMutation({ mutationFn: (input: ProductInput) => api.createProduct(input), onSuccess: invalidate });
}

export function useUpdateProduct() {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<ProductInput> }) => api.updateProduct(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteProduct() {
  const invalidate = useInvalidateCatalog();
  return useMutation({ mutationFn: (id: string) => api.deleteProduct(id), onSuccess: invalidate });
}

export function useCreateRelease() {
  const invalidate = useInvalidateCatalog();
  return useMutation({ mutationFn: (input: ReleaseInput) => api.createRelease(input), onSuccess: invalidate });
}

export function useUpdateRelease() {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<ReleaseInput> }) => api.updateRelease(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteRelease() {
  const invalidate = useInvalidateCatalog();
  return useMutation({ mutationFn: (id: string) => api.deleteRelease(id), onSuccess: invalidate });
}
