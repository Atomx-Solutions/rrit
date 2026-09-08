<script setup lang="ts">
defineProps<{ title: string; description?: string; eyebrow?: string }>()
</script>
<template>
  <UPageHeader
    :title="title"
    :description="description"
    :headline="eyebrow"
    :ui="{
      root: 'border-0 py-0 mb-6',
      container: 'grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-x-5 gap-y-2',
      wrapper: 'contents',
      title: 'order-1 text-2xl sm:text-2xl font-semibold tracking-tight',
      description: 'order-2 lg:col-start-1 lg:row-start-2 mt-0 text-sm text-muted leading-relaxed',
      headline: 'text-[10px] tracking-[.15em] uppercase text-primary font-semibold',
      links:
        'order-3 lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:self-center flex-wrap gap-2 mt-3 lg:mt-0',
    }"
    ><template v-if="$slots.default" #links><slot /></template
  ></UPageHeader>
</template>
