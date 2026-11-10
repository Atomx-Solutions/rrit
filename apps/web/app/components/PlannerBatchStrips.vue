<script setup lang="ts">
import type { Post } from '~~/shared/schemas/workspace'

/**
 * What a finished request made, as two cards side by side: its posts and its
 * videos. Each card is one row of tiles that scrolls sideways, so it keeps the
 * same height for two drafts or thirty. The picture opens the preview, the
 * title opens the post.
 */
const props = defineProps<{ posts: Post[] }>()
const { t } = useI18n()
const { base } = useWorkspace()

const groups = computed(() => [
  { key: 'posts', icon: 'i-lucide-image', label: t('content.filterPosts'), empty: t('monthly.noPostsInRequest'), items: props.posts.filter((post) => !post.video) },
  { key: 'videos', icon: 'i-lucide-clapperboard', label: t('content.filterVideos'), empty: t('monthly.noVideosInRequest'), items: props.posts.filter((post) => post.video) },
])

type TileState = 'ready' | 'rendering' | 'failed'
function stateOf(post: Post): TileState {
  if (post.video?.status === 'failed' || post.status === 'failed') return 'failed'
  if (videoPending(post.video)) return 'rendering'
  return 'ready'
}

// One preview per card, moving through that card's drafts only.
const viewer = ref<{ items: Post[]; index: number } | null>(null)
const viewerOpen = computed({
  get: () => !!viewer.value,
  set: (open) => { if (!open) viewer.value = null },
})
const viewerIndex = computed({
  get: () => viewer.value?.index ?? 0,
  set: (index) => { if (viewer.value) viewer.value.index = index },
})
</script>

<template>
  <!-- One root, so the spacing a parent gives this block reaches it. -->
  <div v-if="posts.length">
  <div class="grid gap-3 lg:grid-cols-2">
    <section
      v-for="group in groups"
      :key="group.key"
      class="flex min-w-0 flex-col gap-4 rounded-xl border border-primary/20 bg-primary/5 p-4"
    >
      <!-- The same card as Generate more posts above it. -->
      <div class="flex items-center gap-3">
        <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <UIcon :name="group.icon" class="size-4" />
        </div>
        <h3 class="text-sm font-semibold text-highlighted">{{ group.label }}</h3>
        <UBadge color="primary" variant="subtle" size="sm">{{ group.items.length }}</UBadge>
      </div>
      <!-- Each kind keeps its half even when the request made none of it. -->
      <p v-if="!group.items.length" class="flex h-32 items-center justify-center rounded-lg border border-dashed border-primary/20 bg-default/60 text-xs text-muted">
        {{ group.empty }}
      </p>
      <ul v-else class="flex gap-3 overflow-x-auto pb-1">
        <li v-for="(post, index) in group.items" :key="post.id" class="w-32 shrink-0">
          <UButton
            color="neutral"
            variant="ghost"
            class="relative block aspect-square w-full overflow-hidden rounded-lg p-0 ring-primary hover:ring-2"
            :aria-label="t('monthly.previewDraft', { title: post.title })"
            @click="viewer = { items: group.items, index }"
          >
            <MediaThumbnail :post="post" :alt="post.title" width="128" height="128" class="size-full" />
          </UButton>
          <NuxtLink
            :to="`${base}/content/${post.id}`"
            class="mt-1.5 flex items-center gap-1 rounded text-xs focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
          >
            <span class="min-w-0 flex-1 truncate font-medium text-highlighted hover:underline">{{ post.title }}</span>
            <UIcon
              v-if="stateOf(post) === 'rendering'"
              name="i-lucide-loader-circle"
              class="size-3.5 shrink-0 animate-spin text-primary"
              :aria-label="t('monthly.videoRendering')"
            />
            <UIcon
              v-else-if="stateOf(post) === 'failed'"
              name="i-lucide-circle-x"
              class="size-3.5 shrink-0 text-error"
              :aria-label="t('status.videoFailed')"
            />
            <UIcon
              v-else
              name="i-lucide-check-check"
              class="size-3.5 shrink-0 text-success"
              :aria-label="t('monthly.draftReady')"
            />
          </NuxtLink>
        </li>
      </ul>
    </section>
  </div>
  <PostViewer v-model:open="viewerOpen" v-model:index="viewerIndex" :posts="viewer?.items || []" />
  </div>
</template>
