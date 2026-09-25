<script setup lang="ts">
// One short row on a phone, the full set of controls from `sm` up. This is not
// optional: every admin page used to ask for it and every customer page forgot,
// which left the customer lists with a two-row pagination bar on a phone.
// The admin still opts into page numbers and edge buttons on top.
withDefaults(defineProps<{ total: number; siblingCount?: number; showEdges?: boolean }>(), {
  siblingCount: 0,
  showEdges: false,
})
const page = defineModel<number>('page', { required: true })
const pageSize = defineModel<number>('pageSize', { required: true })
const { t } = useI18n()
</script>
<template>
  <div
    class="flex items-center justify-between gap-2 border-t border-default px-3 py-2 sm:flex-wrap sm:gap-3 sm:px-4 sm:py-3"
  >
    <div class="flex min-w-0 items-center gap-3 text-xs text-muted">
      <span role="status" class="whitespace-nowrap"
        >{{ total ? (page - 1) * pageSize + 1 : 0 }}–{{ Math.min(page * pageSize, total) }} {{ t('common.of') }}
        {{ total }}</span
      >
      <!-- Page size is a refinement, not a way to move through the list, so the
           phone keeps the row short and leaves it to the wider layout. -->
      <USelect
        v-model="pageSize"
        :items="[5, 10, 20, 50].map((value) => ({ label: `${value} ${t('common.perPage')}`, value }))"
        size="sm"
        class="hidden sm:inline-flex"
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
      :ui="{ first: 'hidden sm:inline-flex', last: 'hidden sm:inline-flex', list: 'gap-0.5 sm:gap-1' }"
    />
  </div>
</template>
