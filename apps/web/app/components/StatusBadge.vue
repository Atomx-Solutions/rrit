<script setup lang="ts">
import type { statusLabels } from '~~/shared/utils/format'
defineProps<{ status: keyof typeof statusLabels }>()
const colors = {
  draft: 'neutral',
  review: 'warning',
  approved: 'success',
  scheduled: 'info',
  published: 'success',
  failed: 'error',
} as const
const icons = {
  draft: 'i-lucide-file-pen-line',
  review: 'i-lucide-clock-3',
  approved: 'i-lucide-check',
  scheduled: 'i-lucide-calendar-days',
  published: 'i-lucide-circle-check',
  failed: 'i-lucide-circle-alert',
}
const { t } = useI18n()
const labels = {
  draft: 'status.draft',
  review: 'status.review',
  approved: 'status.approved',
  scheduled: 'status.scheduled',
  published: 'status.published',
  failed: 'status.failed',
} as const
</script>
<template>
  <UBadge :color="colors[status]" :icon="icons[status]" variant="subtle" size="sm">
    {{ t(labels[status]) }}
  </UBadge>
</template>
