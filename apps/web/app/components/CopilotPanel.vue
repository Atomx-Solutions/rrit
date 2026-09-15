<script setup lang="ts">
const emit = defineEmits<{ navigate: [] }>()
const { base } = useWorkspace()
const { t } = useI18n()
const suggestions = [
  {
    title: () => `1. ${t('copilot.setupBusiness')}`,
    description: () => t('copilot.setupBusinessDescription'),
    path: 'brand',
    icon: 'i-lucide-store',
  },
  {
    title: () => `2. ${t('copilot.connectNetworks')}`,
    description: () => t('copilot.connectNetworksDescription'),
    path: 'social-posts',
    icon: 'i-lucide-link',
  },
  {
    title: () => `3. ${t('copilot.createPost')}`,
    description: () => t('copilot.createPostDescription'),
    path: 'content/new',
    icon: 'i-lucide-square-pen',
  },
  {
    title: () => `4. ${t('copilot.reviewApprove')}`,
    description: () => t('copilot.reviewApproveDescription'),
    path: 'content?status=review',
    icon: 'i-lucide-check-check',
  },
  {
    title: () => `5. ${t('copilot.watchSchedule')}`,
    description: () => t('copilot.watchScheduleDescription'),
    path: 'calendar',
    icon: 'i-lucide-calendar-days',
  },
]
</script>
<template>
  <div class="space-y-4">
    <p class="text-sm text-muted">
      {{ t('legacy.copilotDescription') }}
    </p>
    <UPageCard
      v-for="item in suggestions"
      :key="item.path"
      :to="base + '/' + item.path"
      :title="item.title()"
      :description="item.description()"
      :icon="item.icon"
      variant="outline"
      :ui="{ container: 'p-5', title: 'text-sm', description: 'text-sm leading-relaxed' }"
      @click="emit('navigate')"
    /><UButton to="/help" target="_blank" variant="link" color="neutral"
      >{{ t('copilot.readAll') }}</UButton
    >
  </div>
</template>
