<script setup lang="ts">
import type { Post } from '~~/shared/schemas/workspace'
const props = withDefaults(
  defineProps<{
    post: Pick<Post, 'image' | 'video' | 'title'>
    alt?: string
    width?: string | number
    height?: string | number
    loading?: 'eager' | 'lazy'
    fit?: 'cover' | 'contain' | 'natural'
    surface?: boolean
  }>(),
  { alt: '', width: undefined, height: undefined, loading: 'lazy', fit: 'cover', surface: true },
)
const { t } = useI18n()
// A post is treated as a playable video only when its structured brief says the
// render finished. The first-frame image stays as the poster so the thumbnail is
// still recognizable before the overlay is drawn.
const videoStatus = computed(() => props.post.video?.status)
const isReadyVideo = computed(() => videoStatus.value === 'ready')
const isPendingVideo = computed(() =>
  videoStatus.value === 'brief_ready' || videoStatus.value === 'rendering',
)
const isFailedVideo = computed(() => videoStatus.value === 'failed')
</script>
<template>
  <div class="relative">
    <MediaImage
      :src="post.image || ''"
      :alt="alt || post.title || ''"
      :width="width"
      :height="height"
      :loading="loading"
      :fit="fit"
      :surface="surface"
      class="size-full"
    />
    <!-- Ready: a play badge over the first-frame poster. The thumbnail stays
         clickable through its parent; the badge is decorative, so pointer
         events pass through to whatever the row already wired up. -->
    <span
      v-if="isReadyVideo"
      class="pointer-events-none absolute inset-0 flex items-center justify-center"
      :aria-label="t('video.ready')"
    >
      <span
        class="flex size-8 items-center justify-center rounded-full bg-black/55 text-white shadow ring-1 ring-white/40"
      >
        <UIcon name="i-lucide-play" class="size-4" />
      </span>
    </span>
    <span
      v-else-if="isPendingVideo"
      class="pointer-events-none absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-default/90 text-muted shadow"
      :title="t('video.rendering')"
    >
      <UIcon name="i-lucide-loader" class="size-3.5 animate-spin" />
    </span>
    <span
      v-else-if="isFailedVideo"
      class="pointer-events-none absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-error/90 text-inverted shadow"
      :title="t('video.failed')"
    >
      <UIcon name="i-lucide-alert-triangle" class="size-3.5" />
    </span>
  </div>
</template>
