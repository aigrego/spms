import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';

/* Shared factory behind the entity stores (issues / requirements / testcases /
   plans): list + detail queries, one invalidator, and create/update/delete
   mutations with identical cache-key and invalidation semantics.

   The cross-entity invalidation list is maintained HERE, centrally, keyed by
   the entity's list key — so a mutation can't forget a dependent view
   (BUG-61 class: issue mutations used to leave the product-backlog view stale
   because ['backlog'] was missing from the issue store's invalidation list). */
const CROSS_ENTITY_KEYS: Record<string, QueryKey[]> = {
  issues: [
    // An issue's requirement link affects requirement issue-counts/lists.
    ['requirements'],
    ['requirement'],
    // Status/storyPoints/sprintId changes move sprint stats, burndown & velocity.
    ['sprint'],
    ['burndown'],
    ['velocity'],
    // Backlog = todo issues committed to no sprint; issue create/update/delete/
    // archive all change its membership.
    ['backlog'],
  ],
};

export function createEntityHooks<ListParams, ListItem, Detail, CreateInput, UpdateInput>(config: {
  keys: { list: string; detail: string };
  api: {
    list: (params?: ListParams) => Promise<ListItem[]>;
    detail: (id: string) => Promise<Detail>;
    create: (input: CreateInput) => Promise<NonNullable<Detail>>;
    update: (id: string, input: UpdateInput) => Promise<NonNullable<Detail>>;
    remove: (id: string) => Promise<unknown>;
  };
  extraKeys?: QueryKey[];
}) {
  const { keys, api: entityApi } = config;
  const extraKeys = [...(CROSS_ENTITY_KEYS[keys.list] ?? []), ...(config.extraKeys ?? [])];

  function useList(params?: ListParams) {
    return useQuery({ queryKey: [keys.list, params ?? {}], queryFn: () => entityApi.list(params) });
  }

  function useDetail(id: string | null) {
    return useQuery({ queryKey: [keys.detail, id], queryFn: () => entityApi.detail(id!), enabled: !!id });
  }

  /* Invalidates the entity's list (every params variant) and, when given, the
     detail, plus all registered cross-entity keys. */
  function useInvalidate() {
    const qc = useQueryClient();
    return (id?: string) => {
      qc.invalidateQueries({ queryKey: [keys.list] });
      if (id) qc.invalidateQueries({ queryKey: [keys.detail, id] });
      for (const key of extraKeys) qc.invalidateQueries({ queryKey: key });
    };
  }

  function useCreate() {
    const invalidate = useInvalidate();
    return useMutation({ mutationFn: (input: CreateInput) => entityApi.create(input), onSuccess: () => invalidate() });
  }

  function useUpdate() {
    const invalidate = useInvalidate();
    return useMutation({
      mutationFn: ({ id, input }: { id: string; input: UpdateInput }) => entityApi.update(id, input),
      onSuccess: (_d, vars) => invalidate(vars.id),
    });
  }

  function useDelete() {
    const invalidate = useInvalidate();
    return useMutation({ mutationFn: (id: string) => entityApi.remove(id), onSuccess: () => invalidate() });
  }

  return { useList, useDetail, useInvalidate, useCreate, useUpdate, useDelete };
}
