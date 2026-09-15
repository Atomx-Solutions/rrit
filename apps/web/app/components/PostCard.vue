<script setup lang="ts">
import type { Post } from '~~/shared/schemas/workspace'
import { formatDate } from '~~/shared/utils/format'
defineProps<{ post: Post; compact?: boolean }>()
const { base, data } = useWorkspace()
const { t } = useI18n()
</script>
<template>
  <UCard
    as="article"
    class="post-card overflow-hidden h-full flex flex-col transition-shadow hover:shadow-sm"
    :ui="{
      header: 'p-0 sm:p-0 border-0',
      body: 'p-4 sm:p-4 flex-1',
      footer: 'p-4 sm:p-4 border-t border-default',
    }"
  >
    <template #header
      ><ULink
        :to="`${base}/content/${post.id}`"
        :aria-label="t('content.openPost', { title: post.title })"
        class="block relative"
        ><MediaImage
          :src="post.image"
          :alt="post.title"
          class="w-full aspect-[4/3] object-cover bg-elevated"
          loading="lazy"
          width="500"
          height="380"
        /><UBadge
          :icon="post.channel === 'Instagram' ? 'i-lucide-instagram' : 'i-lucide-facebook'"
          color="neutral"
          variant="solid"
          size="sm"
          class="absolute bottom-3 left-3 bg-default/95 text-default shadow-sm"
          >{{ post.channel }}</UBadge
        ></ULink
      ></template
    >
    <div class="space-y-3">
      <StatusBadge :status="post.status" />
      <h3 class="text-sm font-semibold leading-relaxed line-clamp-2">
        <ULink :to="`${base}/content/${post.id}`" class="text-highlighted hover:text-primary">{{
          post.title
        }}</ULink>
      </h3>
      <p v-if="!compact" class="text-sm text-muted line-clamp-2 leading-relaxed">
        {{ post.caption }}
      </p>
    </div>
    <template #footer
      ><div class="flex flex-wrap items-center justify-between gap-3">
        <span class="text-xs text-muted">{{
          post.scheduledAt ? formatDate(post.scheduledAt, data.preferences.timezone) : t('content.noSchedule')
        }}</span
        ><UButton
          :to="`${base}/content/${post.id}`"
          variant="outline"
          :color="post.status === 'review' ? 'primary' : 'neutral'"
          size="sm"
          trailing-icon="i-lucide-arrow-right"
          >{{ post.status === 'review' ? t('content.reviewPost') : t('content.openPostLabel') }}</UButton
        >
      </div></template
    >
  </UCard>
</template>
