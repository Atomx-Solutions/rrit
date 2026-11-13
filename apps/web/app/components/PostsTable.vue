<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { Post } from '~~/shared/schemas/workspace'
import { formatDate } from '~~/shared/utils/format'
import { canDeletePost } from '~~/shared/utils/post-deletion'
// `selectable` turns on the checkboxes, as in the gallery; the page that owns
// the selection also owns what is done with it.
const props = defineProps<{ posts: Post[]; selectable?: boolean }>()
const selected = defineModel<string[]>('selected', { default: () => [] })
const { base, data } = useWorkspace()
const { t, locale } = useI18n()
function toggleSelected(post: Post, value: boolean | 'indeterminate') {
  selected.value = value === true
    ? [...new Set([...selected.value, post.id])]
    : selected.value.filter((id) => id !== post.id)
}
// The preview window is shared with the planner's ready card.
const viewerOpen = ref(false)
const viewerIndex = ref(0)
function openViewer(post: Post) {
  const index = props.posts.findIndex((item) => item.id === post.id)
  if (index < 0) return
  viewerIndex.value = index
  viewerOpen.value = true
}
const columns = computed<TableColumn<Post>[]>(() => [
  ...(props.selectable ? [{ id: 'select', header: '' }] : []),
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
      <div v-if="selectable" class="flex shrink-0 self-stretch items-center" @click.prevent.stop>
        <UCheckbox
          :model-value="selected.includes(post.id)"
          :disabled="!canDeletePost(post)"
          :aria-label="t('content.selectPost', { title: post.title })"
          @update:model-value="(value) => toggleSelected(post, value)"
        />
      </div>
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
          <UBadge v-if="post.video?.status === 'failed'" color="error" variant="subtle" size="sm" icon="i-lucide-video-off">{{ t('status.videoFailed') }}</UBadge>
          <StatusBadge v-else :status="post.status" />
          <RepostBadge :post="post" />
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
      th: selectable
        ? 'py-3 px-4 text-xs font-medium first:w-12 first:pe-0 [&:nth-child(2)]:w-[40%] last:w-16'
        : 'py-3 px-4 text-xs font-medium first:w-[42%] last:w-16',
      td: 'px-4 py-4 border-b border-default',
      tbody: '[&>tr]:last:[&>td]:border-b-0',
      separator: 'h-0',
    }"
  >
    <template #select-cell="{ row }"
      ><UCheckbox
        :model-value="selected.includes(row.original.id)"
        :disabled="!canDeletePost(row.original)"
        :aria-label="t('content.selectPost', { title: row.original.title })"
        @update:model-value="(value) => toggleSelected(row.original, value)"
    /></template>
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
    <template #status-cell="{ row }"><span class="inline-flex flex-wrap gap-1"><UBadge v-if="row.original.video?.status === 'failed'" color="error" variant="subtle" size="sm" icon="i-lucide-video-off">{{ t('status.videoFailed') }}</UBadge><StatusBadge v-else :status="row.original.status" /><RepostBadge :post="row.original" /></span></template>
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
        variant="outline"
        size="sm"
        icon="i-lucide-arrow-up-right"
        class="hover:bg-primary/10 hover:text-primary hover:ring-primary/40"
        :aria-label="t('content.openPost', { title: row.original.title })"
    /></template>
  </UTable>
  <PostViewer v-model:open="viewerOpen" v-model:index="viewerIndex" :posts="props.posts" />
</template>
