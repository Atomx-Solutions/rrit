<script setup lang="ts">
defineProps<{ total: number }>()
const page = defineModel<number>('page', { required: true })
const pageSize = defineModel<number>('pageSize', { required: true })
</script>
<template>
  <div class="flex flex-wrap items-center justify-between gap-3 border-t border-default px-4 py-3">
    <div class="flex items-center gap-3 text-xs text-muted">
      <span role="status"
        >{{ total ? (page - 1) * pageSize + 1 : 0 }}–{{ Math.min(page * pageSize, total) }} nga
        {{ total }}</span
      >
      <USelect
        v-model="pageSize"
        :items="[5, 10, 20, 50].map((value) => ({ label: `${value} për faqe`, value }))"
        size="sm"
        aria-label="Rreshta për faqe"
      />
    </div>
    <UPagination
      v-model:page="page"
      :total="total"
      :items-per-page="pageSize"
      :sibling-count="0"
      :show-edges="false"
      size="sm"
      color="neutral"
      active-color="primary"
      active-variant="outline"
    />
  </div>
</template>
