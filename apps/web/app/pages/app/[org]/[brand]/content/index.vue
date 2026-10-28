<script setup lang="ts">
import { statusLabels } from '~~/shared/utils/format'
import { postSchema } from '~~/shared/schemas/workspace'
definePageMeta({ layout: 'dashboard', middleware: 'workspace' })
const { data, base } = useWorkspace()
const { t } = useI18n()
useSeoMeta({ title: () => `${t('content.yourPosts')} · Framic` })
const route = useRoute()
const search = ref('')
const filter = computed({
  get: () =>
    typeof route.query.status === 'string' && Object.hasOwn(statusLabels, route.query.status)
      ? route.query.status
      : 'all',
  set: (status: string) => {
    void navigateTo(
      {
        path: route.path,
        query: { ...route.query, status: status === 'all' ? undefined : status },
      },
      { replace: true },
    )
  },
})
const channel = ref('all')
// Every network a post can be saved for, so the filter never misses one.
const channelItems = computed(() => [
  { label: t('content.allChannels'), value: 'all' },
  ...postSchema.shape.channel.options,
])
const format = ref<'all' | 'video' | 'post'>('all')
const hasFilters = computed(
  () => !!search.value.trim() || filter.value !== 'all' || channel.value !== 'all' || format.value !== 'all',
)
function resetFilters() {
  search.value = ''
  filter.value = 'all'
  channel.value = 'all'
  format.value = 'all'
}
const tabs = computed(() => [
  { value: 'all', label: t('overview.all') },
  ...Object.keys(statusLabels).map((value) => ({ value, label: t(`status.${value}`) })),
])
const posts = computed(() =>
  data.value.posts.filter(
    (p) =>
      (filter.value === 'all' || p.status === filter.value) &&
      (channel.value === 'all' || p.channel === channel.value) &&
      (format.value === 'all' || (format.value === 'video' ? !!p.video : !p.video)) &&
      `${p.title} ${p.caption}`
        .toLocaleLowerCase('sq')
        .includes(search.value.trim().toLocaleLowerCase('sq')),
  ),
)
const { page, pageSize, total, paginated } = usePagination(posts)
watch([search, filter, channel, format], () => {
  page.value = 1
})
</script>
<template>
  <DashboardPage
    :title="t('content.yourPosts')"
    :description="t('content.yourPostsDescription')"
    :toolbar-border="false"
  >
    <!-- The search spans the first row on a phone; keep filters and the create
         action together below it so the plus button never lands between rows. -->
    <template #toolbar>
      <div class="flex w-full flex-wrap items-center gap-2 sm:flex-nowrap sm:justify-between sm:gap-3">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          :placeholder="t('content.searchPlaceholder')"
          :aria-label="t('content.searchPosts')"
          class="w-full min-w-0 sm:w-72"
        />
        <div class="actions flex w-full min-w-0 items-center gap-2 sm:w-auto sm:shrink-0">
          <USelect
            v-model="format"
            :items="[{ label: t('content.allFormats'), value: 'all' }, { label: t('content.postsOnly'), value: 'post' }, { label: t('content.videoOnly'), value: 'video' }]"
            :aria-label="t('content.filterFormat')"
            class="min-w-0 flex-1 sm:w-auto sm:flex-none"
          />
          <USelect
            v-model="channel"
            :items="channelItems"
            :aria-label="t('content.filterChannel')"
            class="min-w-0 flex-1 sm:w-auto sm:flex-none"
          />
          <UButton
            variant="outline"
            :to="`${base}/monthly-planner`"
            icon="i-lucide-plus"
            :label="t('content.createPost')"
            :aria-label="t('content.createPost')"
            :ui="{ label: 'hidden sm:inline' }"
            class="shrink-0"
          />
        </div>
      </div>
    </template>
    <!-- Seven statuses wrap onto a second row on a phone and eat the space the
         post list needs, so there they stay on one row and scroll sideways; the
         next tab stays half visible to show there is more. -->
    <UTabs
      v-model="filter"
      :items="tabs"
      value-key="value"
      :content="false"
      variant="link"
      class="border-b border-default"
      :ui="{
        list: 'gap-1 flex-nowrap overflow-x-auto overflow-y-hidden sm:flex-wrap sm:overflow-x-visible',
        trigger: 'grow-0 shrink-0 px-3 min-h-10',
      }"
    />
    <div class="flex items-center justify-between gap-3">
      <p role="status" class="text-sm text-muted">
        {{ t('content.postCount', { visible: posts.length, total: data.posts.length }) }}
      </p>
      <UButton
        v-if="hasFilters"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-x"
        @click="resetFilters"
        >{{ t('content.clearFilters') }}</UButton
      >
    </div>
    <UCard v-if="posts.length" as="div" :ui="{ body: 'p-0 sm:p-0' }" class="table-wrap">
      <PostsTable :posts="paginated" />
      <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" />
    </UCard>
    <DashboardEmpty
      v-else
      :title="t('content.noPosts')"
      :description="t('content.noPostsDescription')"
      icon="i-lucide-search-x"
      :actions="[{ label: t('content.createPost'), to: `${base}/monthly-planner`, color: 'primary' }]"
    />
  </DashboardPage>
</template>
