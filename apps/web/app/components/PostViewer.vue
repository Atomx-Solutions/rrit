<script setup lang="ts">
import type { Post } from '~~/shared/schemas/workspace'
import { channelCanvas } from '~~/shared/schemas/channel-format'

/** The full-screen preview of a list of posts: photo or video, arrows, strip and download. */
const props = defineProps<{ posts: Post[] }>()
const viewerOpen = defineModel<boolean>('open', { default: false })
const viewerIndex = defineModel<number>('index', { default: 0 })
const { t } = useI18n()
const downloading = ref(false)
const viewerPost = computed(() => props.posts[viewerIndex.value] || null)
// A ready video's playable mp4 is served through /api/videos/:renderId, so the
// viewer resolves it only after the user opens a post whose brief reports a
// finished render. The map keeps the resolution per post so flipping back and
// forth in the viewer does not re-fetch what is already known.
const videoPreviews = ref<Record<string, string | null>>({})
const resolvingVideo = ref(false)
const viewerVideoUrl = computed(() => {
  const post = viewerPost.value
  if (!post || post.video?.status !== 'ready') return null
  return videoPreviews.value[post.id] ?? null
})
async function playWithSound(event: Event) {
  const video = event.target as HTMLVideoElement
  try {
    await video.play()
  } catch {
    video.muted = true
    await video.play().catch(() => {})
  }
}
async function resolveViewerVideo() {
  const post = viewerPost.value
  if (!post || post.video?.status !== 'ready') return
  if (post.id in videoPreviews.value) return
  resolvingVideo.value = true
  try {
    const response = await $fetch<{ render: { previewUrl: string | null } | null }>(
      `/api/posts/${post.id}/video`,
    )
    videoPreviews.value[post.id] = response.render?.previewUrl || null
  } catch {
    videoPreviews.value[post.id] = null
  } finally {
    resolvingVideo.value = false
  }
}
// Opening, or moving to another post, fetches that post's video if it has one.
watch([viewerOpen, viewerIndex], ([open]) => {
  if (open) void resolveViewerVideo()
}, { immediate: true })
function moveViewer(offset: number) {
  if (!props.posts.length) return
  viewerIndex.value = (viewerIndex.value + offset + props.posts.length) % props.posts.length
}
// The arrow keys move through the posts like the gallery viewer, except while
// a video or a field has focus, where they belong to it.
function onViewerKeydown(event: KeyboardEvent) {
  if (!viewerOpen.value) return
  const target = event.target as HTMLElement | null
  if (target?.closest('video, input, textarea, [contenteditable="true"]')) return
  if (event.key === 'ArrowLeft') moveViewer(-1)
  if (event.key === 'ArrowRight') moveViewer(1)
}
// The stage keeps the post's channel shape while the next photo loads, so the
// controls never jump and the viewer never flashes empty.
const viewerFrame = computed(() => {
  if (!viewerPost.value) return undefined
  const { width, height } = channelCanvas(viewerPost.value.channel)
  return { aspectRatio: `${width} / ${height}` }
})
// The photos either side are fetched ahead, so stepping to them is instant.
watch([viewerOpen, viewerIndex], ([open]) => {
  if (!open || !import.meta.client || !props.posts.length) return
  for (const offset of [-1, 1]) {
    const neighbour = props.posts[(viewerIndex.value + offset + props.posts.length) % props.posts.length]
    if (neighbour?.image) new Image().src = neighbour.image
  }
})
const viewerStrip = ref<HTMLElement | null>(null)
useCenteredStrip(viewerStrip, viewerIndex, viewerOpen)
onMounted(() => window.addEventListener('keydown', onViewerKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onViewerKeydown))
async function downloadViewerPost() {
  if (!viewerPost.value || downloading.value) return
  downloading.value = true
  try {
    // A ready video downloads the mp4; the fallback is still the first-frame
    // image, so a static post keeps the exact behaviour it had before.
    const isVideo = viewerPost.value.video?.status === 'ready' && !!viewerVideoUrl.value
    const source = isVideo ? viewerVideoUrl.value! : viewerPost.value.image
    const response = await fetch(source, { credentials: 'include' })
    if (!response.ok) throw new Error('download failed')
    const blob = await response.blob()
    saveFile(blob, viewerPost.value.title || 'framic-post', isVideo ? 'video/mp4' : 'image/jpeg')
  } finally {
    downloading.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="viewerOpen"
    fullscreen
    :title="viewerPost?.title || t('content.postPhotoViewer')"
    :description="t('content.postPhotoViewerDescription')"
  >
    <template #body>
      <div v-if="viewerPost" class="flex h-[calc(100dvh-12rem)] min-h-[36rem] flex-col gap-5">
        <!-- A feed post is 4:5, so a full-width stage behind it is mostly
             empty surface. The dialog's own background carries the picture and
             the controls sit beside it, rather than a dark panel being drawn
             across the width of the screen. -->
        <div class="relative flex min-h-0 flex-1 items-center justify-center gap-3 sm:gap-5">
          <UButton
            color="neutral"
            variant="outline"
            size="lg"
            class="shrink-0 rounded-full"
            icon="i-lucide-chevron-left"
            :aria-label="t('content.previousPostPhoto')"
            @click="moveViewer(-1)"
          />
          <!-- The video starts on its own with sound when opened. Opening it is a
               click, so browsers normally allow that; one that still refuses
               gets it muted rather than not playing. -->
          <template v-if="viewerVideoUrl">
            <video
              :key="`video-${viewerPost.id}`"
              :src="viewerVideoUrl"
              :poster="viewerPost.image"
              controls
              playsinline
              class="h-full w-auto max-w-full rounded-xl bg-black ring-1 ring-default"
              @loadeddata="playWithSound"
            />
          </template>
          <div v-if="!viewerVideoUrl" class="h-full max-w-full min-w-0" :style="viewerFrame">
            <MediaImage
              :src="viewerPost.image"
              :alt="viewerPost.title"
              fit="contain"
              loading="eager"
              :surface="false"
              class="size-full rounded-xl"
            />
          </div>
          <UButton
            color="neutral"
            variant="outline"
            size="lg"
            class="shrink-0 rounded-full"
            icon="i-lucide-chevron-right"
            :aria-label="t('content.nextPostPhoto')"
            @click="moveViewer(1)"
          />
        </div>
        <div class="flex items-center justify-between gap-3">
          <p class="min-w-0 truncate text-sm text-muted">
            {{ viewerIndex + 1 }} / {{ props.posts.length }} · {{ viewerPost.title }}
          </p>
          <UButton
            color="primary"
            icon="i-lucide-download"
            :loading="downloading"
            @click="downloadViewerPost"
          >
            {{ t('common.download') }}
          </UButton>
        </div>
        <!-- p-1/-m-1: the selected thumbnail draws its ring outside its box, and
             a scroll container clips anything outside its padding box. The
             padding gives the ring room, the negative margin keeps the strip
             aligned with the rest. -->
        <div ref="viewerStrip" class="flex gap-2 overflow-x-auto p-1 -m-1">
          <UButton
            v-for="(post, index) in props.posts"
            :key="post.id"
            color="neutral"
            variant="ghost"
            class="size-16 shrink-0 overflow-hidden rounded-lg p-0"
            :class="
              index === viewerIndex
                ? 'ring-2 ring-primary ring-offset-2'
                : 'opacity-70 hover:opacity-100'
            "
            :aria-label="post.title"
            @click="viewerIndex = index"
          >
            <MediaThumbnail
              :post="post"
              :alt="post.title"
              class="size-full"
              width="64"
              height="64"
            />
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
