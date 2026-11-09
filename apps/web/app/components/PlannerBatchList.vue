<script setup lang="ts">
import type { Post } from '~~/shared/schemas/workspace'

/**
 * What the planner made in the current request, one row per post or video, as
 * it arrives: the business sees each draft appear instead of a bare counter,
 * and can open any of them straight away. Rows still to come wait below.
 */
const props = withDefaults(
  defineProps<{
    posts: Post[]
    // Deliverables of the request not made yet; the first is the one in work.
    pending?: number
    // Whether the planner is still working, so the first pending row spins.
    working?: boolean
  }>(),
  { pending: 0, working: false },
)
const { t } = useI18n()
const { base } = useWorkspace()

type RowState = 'ready' | 'rendering' | 'failed'
function stateOf(post: Post): RowState {
  if (post.video?.status === 'failed' || post.status === 'failed') return 'failed'
  if (videoPending(post.video)) return 'rendering'
  return 'ready'
}
const rows = computed(() => props.posts.map((post) => ({ post, state: stateOf(post) })))
// The picture opens the same preview as the posts list; the rest of the row
// opens the post.
const viewerOpen = ref(false)
const viewerIndex = ref(0)
function preview(index: number) {
  viewerIndex.value = index
  viewerOpen.value = true
}
const channelIcons: Record<string, string> = {
  Instagram: 'i-lucide-instagram',
  Facebook: 'i-lucide-facebook',
}
</script>

<template>
  <ul v-if="rows.length || pending" class="divide-y divide-default overflow-hidden rounded-xl border border-default bg-default">
    <li v-for="({ post, state }, index) in rows" :key="post.id" class="relative flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-elevated/60">
      <UButton
        color="neutral"
        variant="ghost"
        class="relative z-10 size-11 shrink-0 overflow-hidden rounded-lg p-0 ring-primary hover:ring-2"
        :aria-label="t('monthly.previewDraft', { title: post.title })"
        @click="preview(index)"
      >
        <MediaThumbnail :post="post" :alt="post.title" width="44" height="44" class="size-full" />
      </UButton>
      <NuxtLink
        :to="`${base}/content/${post.id}`"
        class="flex min-w-0 flex-1 items-center gap-3 after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-primary focus-visible:after:ring-inset"
      >
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-highlighted">{{ post.title }}</p>
          <p class="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
            <TikTokMark v-if="post.channel === 'TikTok'" class="size-3.5" />
            <UIcon v-else :name="channelIcons[post.channel] || 'i-lucide-share-2'" class="size-3.5" />
            {{ post.channel }}
            <span aria-hidden="true">·</span>
            {{ post.video ? t('monthly.itemVideo') : t('monthly.itemPost') }}
          </p>
        </div>
        <UBadge
          v-if="state === 'rendering'"
          color="primary"
          variant="subtle"
          icon="i-lucide-loader-circle"
          :ui="{ leadingIcon: 'animate-spin' }"
          class="shrink-0"
        >{{ t('monthly.videoRendering') }}</UBadge>
        <UBadge v-else-if="state === 'failed'" color="error" variant="subtle" icon="i-lucide-circle-x" class="shrink-0">
          {{ t('status.videoFailed') }}
        </UBadge>
        <UBadge v-else color="success" variant="subtle" icon="i-lucide-check-check" class="shrink-0">
          {{ t('monthly.draftReady') }}
        </UBadge>
        <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-dimmed" />
      </NuxtLink>
    </li>
    <li
      v-for="index in pending"
      :key="`pending-${index}`"
      class="flex items-center gap-3 px-3 py-2.5"
    >
      <div class="flex size-11 shrink-0 items-center justify-center rounded-lg bg-elevated">
        <UIcon
          :name="working && index === 1 ? 'i-lucide-loader-circle' : 'i-lucide-image'"
          class="size-4 text-muted"
          :class="working && index === 1 ? 'animate-spin text-primary' : ''"
        />
      </div>
      <div class="min-w-0 flex-1 space-y-1.5">
        <USkeleton class="h-3 w-2/5" />
        <USkeleton class="h-2.5 w-1/4" />
      </div>
      <span class="shrink-0 text-xs text-muted">
        {{ working && index === 1 ? t('monthly.draftInProgress') : t('monthly.draftWaiting') }}
      </span>
    </li>
  </ul>
  <PostViewer v-model:open="viewerOpen" v-model:index="viewerIndex" :posts="props.posts" />
</template>
