export function usePagination<T>(items: Ref<T[]> | ComputedRef<T[]>, initialSize = 10) {
  const page = ref(1)
  const pageSize = ref(initialSize)
  const total = computed(() => items.value.length)
  const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
  watch(pageSize, () => {
    page.value = 1
  })
  watch(pageCount, (count) => {
    page.value = Math.min(page.value, count)
  })
  const paginated = computed(() =>
    items.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value),
  )
  return { page, pageSize, total, paginated }
}
