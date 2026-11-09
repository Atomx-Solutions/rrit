export function useMonthlyPlannerData() {
  return useFetch('/api/ai/monthly-plan', {
    key: 'monthly-planner',
    lazy: true,
    dedupe: 'defer',
  })
}
