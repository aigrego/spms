import { api } from '@/lib/api';
import type { CreatePlanInput, UpdatePlanInput } from '@/lib/api';
import type { Plan } from '@/lib/types';
import { createEntityHooks } from './createEntityHooks';

/* Dev plan (开发计划) queries + mutations, built by the shared entity-hooks
   factory — same cache keys and invalidation semantics as before. */

const planHooks = createEntityHooks<
  Parameters<typeof api.plans>[0],
  Plan,
  Plan | null,
  CreatePlanInput,
  UpdatePlanInput
>({
  keys: { list: 'plans', detail: 'plan' },
  api: {
    list: api.plans,
    detail: api.plan,
    create: api.createPlan,
    update: api.updatePlan,
    remove: api.deletePlan,
  },
});

export const usePlans = planHooks.useList;
export const usePlan = planHooks.useDetail;
export const useCreatePlan = planHooks.useCreate;
export const useUpdatePlan = planHooks.useUpdate;
export const useDeletePlan = planHooks.useDelete;
