<script setup lang="ts">
// The defaults keep the compact customer pagination; the admin shows page numbers
// and, with compactMobile, fits on one short row on phones.
withDefaults(defineProps<{ total: number; siblingCount?: number; showEdges?: boolean; compactMobile?: boolean }>(), {
  siblingCount: 0,
  showEdges: false,
  compactMobile: false,
})
const page = defineModel<number>('page', { required: true })
const pageSize = defineModel<number>('pageSize', { required: true })
const { t } = useI18n()
</script>
<template>
  <div
    class="flex items-center justify-between border-t border-default"
    :class="compactMobile ? 'gap-2 px-3 py-2 sm:flex-wrap sm:gap-3 sm:px-4 sm:py-3' : 'flex-wrap gap-3 px-4 py-3'"
  >
    <div class="flex items-center gap-3 text-xs text-muted">
      <span role="status" class="whitespace-nowrap"
        >{{ total ? (page - 1) * pageSize + 1 : 0 }}–{{ Math.min(page * pageSize, total) }} {{ t('common.of') }}
        {{ total }}</span
      >
      <USelect
        v-model="pageSize"
        :items="[5, 10, 20, 50].map((value) => ({ label: `${value} ${t('common.perPage')}`, value }))"
        size="sm"
        :class="compactMobile ? 'hidden sm:inline-flex' : undefined"
        :content="{ side: 'top', collisionPadding: 8 }"
        :aria-label="t('common.rowsPerPage')"
      />
    </div>
    <UPagination
      v-model:page="page"
      :total="total"
      :items-per-page="pageSize"
      :sibling-count="siblingCount"
      :show-edges="showEdges"
      size="sm"
      color="neutral"
      active-color="primary"
      active-variant="outline"
      :ui="compactMobile ? { first: 'hidden sm:inline-flex', last: 'hidden sm:inline-flex', list: 'gap-0.5 sm:gap-1' } : undefined"
    />
  </div>
</template>
