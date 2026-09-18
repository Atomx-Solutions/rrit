import type { PlanCatalogPlan } from '~~/shared/schemas/catalog'

export function usePlanCatalog() {
  const { data, error, status, refresh } = useFetch<PlanCatalogPlan[]>('/api/plans', { key: 'plan-catalog' })
  const plans = computed(() => data.value || [])
  return { plans, error, status, refresh }
}
