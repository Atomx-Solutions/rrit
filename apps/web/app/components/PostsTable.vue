<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { Post } from '~~/shared/schemas/workspace'
import { formatDate } from '~~/shared/utils/format'
const props = defineProps<{ posts: Post[] }>()
const { base, data } = useWorkspace()
const { t, locale } = useI18n()
const viewerOpen = ref(false)
const viewerIndex = ref(0)
const downloading = ref(false)
const viewerPost = computed(() => props.posts[viewerIndex.value] || null)
// A ready video's playable mp4 is served through /api/videos/:renderId, so the
// viewer resolves it only after the user opens a post whose brief reports a
// finished render. The map keeps the resolution per post so flipping back and
// forth in the viewer does not re-fetch what is already known.
const videoPreviews = ref<Record<string, string | null>>({})
const embeddedEndCards = ref<Record<string, boolean>>({})
const resolvingVideo = ref(false)
const viewerLegacyCardVisible = ref(false)
function handleViewerVideoEnded() {
  const post = viewerPost.value
  if (post?.video?.endCardAssetId && !embeddedEndCards.value[post.id]) viewerLegacyCardVisible.value = true
}
const viewerVideoUrl = computed(() => {
  const post = viewerPost.value
  if (!post || post.video?.status !== 'ready') return null
  return videoPreviews.value[post.id] ?? null
})
async function resolveViewerVideo() {
  const post = viewerPost.value
  if (!post || post.video?.status !== 'ready') return
  if (post.id in videoPreviews.value) return
  resolvingVideo.value = true
  try {
    const response = await $fetch<{ render: { previewUrl: string | null; endCardEmbedded: boolean } | null }>(
      `/api/posts/${post.id}/video`,
    )
    videoPreviews.value[post.id] = response.render?.previewUrl || null
    embeddedEndCards.value[post.id] = response.render?.endCardEmbedded || false
  } catch {
    videoPreviews.value[post.id] = null
  } finally {
    resolvingVideo.value = false
  }
}
function openViewer(post: Post) {
  const index = props.posts.findIndex((item) => item.id === post.id)
  if (index < 0) return
  viewerIndex.value = index
  viewerLegacyCardVisible.value = false
  viewerOpen.value = true
  resolveViewerVideo()
}
function moveViewer(offset: number) {
  if (!props.posts.length) return
  viewerIndex.value = (viewerIndex.value + offset + props.posts.length) % props.posts.length
  viewerLegacyCardVisible.value = false
  resolveViewerVideo()
}
async function downloadViewerPost() {
  if (!viewerPost.value || downloading.value) return
  downloading.value = true
  try {
    // A ready video downloads the mp4; the fallback is still the first-frame
    // image, so a static post keeps the exact behaviour it had before.
    const isVideo = viewerPost.value.video?.status === 'ready' && !!viewerVideoUrl.value
    const source = isVideo ? viewerVideoUrl.value! : viewerPost.value.image
    const extension = isVideo ? 'mp4' : 'jpg'
    const response = await fetch(source, { credentials: 'include' })
    if (!response.ok) throw new Error('download failed')
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${viewerPost.value.title || 'rrit-post'}.${extension}`
    anchor.click()
    URL.revokeObjectURL(url)
  } finally {
    downloading.value = false
  }
}
const columns = computed<TableColumn<Post>[]>(() => [
  { accessorKey: 'title', header: t('content.post') },
  { accessorKey: 'channel', header: t('content.network') },
  { accessorKey: 'status', header: t('content.status') },
  { accessorKey: 'scheduledAt', header: t('content.schedule') },
  { id: 'actions', header: '' },
])
</script>
<template>
  <div class="md:hidden divide-y divide-default">
    <ULink
      v-for="post in posts"
      :key="post.id"
      :to="`${base}/content/${post.id}`"
      class="flex items-center gap-3 px-4 py-3 active:bg-elevated/50"
    >
      <MediaThumbnail
        :post="post"
        width="48"
        height="48"
        loading="lazy"
        class="size-12 shrink-0 overflow-hidden rounded-md"
        @click.prevent.stop="openViewer(post)"
      />
      <div class="min-w-0 flex-1">
        <h3 class="text-sm font-medium text-highlighted line-clamp-2">{{ post.title }}</h3>
        <!-- Status, channel and date share one line: as three stacked lines they
             made every row taller than the phone needed for a list. -->
        <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <StatusBadge :status="post.status" />
          <span>{{ post.channel }}</span>
          <template v-if="post.scheduledAt">
            <span aria-hidden="true">·</span>
            <span>{{ formatDate(post.scheduledAt, data.preferences.timezone, false, locale) }}</span>
          </template>
        </div>
        <p
          v-if="post.scheduledAt && post.status === 'scheduled'"
          class="mt-1 text-xs text-muted"
        >
          {{
            post.publicationMode === 'automatic'
              ? t('content.automaticPublication')
              : t('content.calendarOnly')
          }}
        </p>
      </div>
      <UIcon name="i-lucide-chevron-right" class="size-4 text-muted shrink-0 self-center" />
    </ULink>
  </div>
  <UTable
    class="hidden md:block"
    :data="posts"
    :columns="columns"
    :empty="t('content.noPostsSelection')"
    :ui="{
      root: 'w-full',
      base: 'w-full table-fixed border-separate border-spacing-0',
      thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
      th: 'py-3 px-4 text-xs font-medium first:w-[42%] last:w-16',
      td: 'px-4 py-4 border-b border-default',
      tbody: '[&>tr]:last:[&>td]:border-b-0',
      separator: 'h-0',
    }"
  >
    <template #title-cell="{ row }">
      <ULink
        :to="`${base}/content/${row.original.id}`"
        class="flex items-center gap-3 min-w-0 group"
      >
        <MediaThumbnail
          :post="row.original"
          width="44"
          height="44"
          loading="lazy"
          class="size-11 shrink-0 overflow-hidden rounded-md"
          @click.prevent.stop="openViewer(row.original)"
        />
        <div class="min-w-0">
          <h3 class="text-sm font-medium text-highlighted truncate group-hover:text-primary">
            {{ row.original.title }}
          </h3>
          <p class="text-xs text-muted truncate mt-1">{{ row.original.caption }}</p>
        </div>
      </ULink>
    </template>
    <template #channel-cell="{ row }">
      <span class="inline-flex items-center gap-2 text-sm"
        ><TikTokLogo v-if="row.original.channel === 'TikTok'" class="size-4 shrink-0 text-white" /><UIcon
          v-else
          :name="channelIcon(row.original.channel)"
          class="size-4 text-muted"
        />{{ row.original.channel }}</span
      >
    </template>
    <template #status-cell="{ row }"><StatusBadge :status="row.original.status" /></template>
    <template #scheduledAt-cell="{ row }"
      ><span class="text-xs text-muted">{{
        row.original.scheduledAt
          ? formatDate(row.original.scheduledAt, data.preferences.timezone, false, locale)
          : t('content.noSchedule')
      }}</span
      ><span v-if="row.original.status === 'scheduled'" class="block text-xs text-muted mt-1">{{
        row.original.publicationMode === 'automatic'
          ? t('content.automaticPublication')
          : t('content.calendarOnly')
      }}</span></template
    >
    <template #actions-cell="{ row }"
      ><UButton
        :to="`${base}/content/${row.original.id}`"
        color="neutral"
        variant="ghost"
        icon="i-lucide-arrow-up-right"
        :aria-label="t('content.openPost', { title: row.original.title })"
    /></template>
  </UTable>
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
          <!-- New MP4s contain the card; historical raw renders retain their
               separate card in Gallery until they are recomposed. -->
          <template v-if="viewerVideoUrl">
            <video
              v-show="!viewerLegacyCardVisible"
              :src="viewerVideoUrl"
              :poster="viewerPost.image"
              controls
              playsinline
              class="h-full w-auto max-w-full rounded-xl bg-black ring-1 ring-default"
              @ended="handleViewerVideoEnded"
            />
            <MediaImage
              v-if="viewerLegacyCardVisible && viewerPost.video?.endCardAssetId"
              :src="`/api/media/${viewerPost.video.endCardAssetId}`"
              :alt="viewerPost.title"
              fit="natural"
              :surface="false"
              class="h-full w-auto max-w-full rounded-xl ring-1 ring-default"
            />
          </template>
          <MediaImage
            v-if="!viewerVideoUrl"
            :src="viewerPost.image"
            :alt="viewerPost.title"
            fit="natural"
            :surface="false"
            class="h-full w-auto max-w-full rounded-xl ring-1 ring-default"
          />
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
        <div class="flex gap-2 overflow-x-auto p-1 -m-1">
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
