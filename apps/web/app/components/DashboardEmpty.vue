<script setup lang="ts">
import type { ButtonProps } from '@nuxt/ui'
defineProps<{ title: string; description: string; icon?: string; actions?: ButtonProps[] }>()
</script>
<template>
  <UEmpty
    :title="title"
    :description="description"
    :icon="icon || 'i-lucide-search'"
    :actions="
      actions?.map((action) => ({
        color: 'neutral' as const,
        variant: 'outline' as const,
        ...action,
      }))
    "
    :ui="{ root: 'p-8 sm:p-12 bg-default', title: 'text-base', description: 'text-sm max-w-md' }"
  />
</template>
