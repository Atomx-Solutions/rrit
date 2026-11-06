<script setup lang="ts">
import { statusLabels } from '~~/shared/utils/format'
import { postSchema } from '~~/shared/schemas/workspace'
definePageMeta({ layout: 'dashboard', middleware: 'workspace' })
const { data, base } = useWorkspace()
useFollowVideos()
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
// Format and network are toggles: nothing chosen filters nothing, and each
// chosen option widens what is shown within its group.
const channels = ref<string[]>([])
const formats = ref<('video' | 'post')[]>([])
const toggled = <T,>(list: T[], value: T) =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
const hasFilters = computed(
  () => !!search.value.trim() || filter.value !== 'all' || channels.value.length > 0 || formats.value.length > 0,
)
function resetFilters() {
  search.value = ''
  filter.value = 'all'
  channels.value = []
  formats.value = []
}
// A post whose video could not be made is not ready, whatever its own status,
// so it is listed with the failed posts and nowhere else.
function inTab(p: (typeof data.value.posts)[number], tab: string) {
  if (tab === 'all') return true
  return p.video?.status === 'failed' ? tab === 'failed' : p.status === tab
}
const tabs = computed(() => [
  { value: 'all', label: t('overview.all') },
  ...Object.keys(statusLabels).map((value) => ({ value, label: t(`status.${value}`) })),
])
// Short labels with an icon each, shown as toggles above the table.
const formatItems = computed(() => [
  { label: t('content.filterPosts'), value: 'post' as const, icon: 'i-lucide-image' },
  { label: t('content.filterVideos'), value: 'video' as const, icon: 'i-lucide-circle-play' },
])
const networkIcons: Record<string, string> = { Facebook: 'i-lucide-facebook', Instagram: 'i-lucide-instagram' }
const networkItems = computed(() => [
  ...postSchema.shape.channel.options.map((value) => ({ label: value, value: value as string, icon: networkIcons[value] })),
])
const posts = computed(() =>
  data.value.posts.filter(
    (p) =>
      inTab(p, filter.value) &&
      (!channels.value.length || channels.value.includes(p.channel)) &&
      (!formats.value.length || formats.value.includes(p.video ? 'video' : 'post')) &&
      `${p.title} ${p.caption}`
        .toLocaleLowerCase('sq')
        .includes(search.value.trim().toLocaleLowerCase('sq')),
  ),
)
const { page, pageSize, total, paginated } = usePagination(posts)
watch([search, filter, channels, formats], () => {
  page.value = 1
})
</script>
<template>
  <DashboardPage
    :title="t('content.yourPosts')"
    :description="t('content.yourPostsDescription')"
    :toolbar-border="false"
  >
    <template #toolbar>
      <div class="flex w-full items-center justify-end">
        <UButton
          :to="`${base}/monthly-planner`"
          variant="outline"
          icon="i-lucide-plus"
          :label="t('content.createPost')"
          class="shrink-0"
        />
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
    <!-- Search and filters sit on the table they narrow, instead of a panel of
         their own; the count of posts shown is in the pagination below. -->
    <UCard v-if="data.posts.length" as="div" :ui="{ body: 'p-0 sm:p-0' }" class="table-wrap">
      <div class="flex flex-wrap items-center gap-2 border-b border-default p-3">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          :placeholder="t('content.searchPlaceholder')"
          :aria-label="t('content.searchPosts')"
          class="w-full sm:w-1/2"
        />
        <div class="flex flex-wrap items-center gap-2 sm:ml-auto" role="group" :aria-label="t('content.filters')">
          <UButton
            v-for="item in formatItems"
            :key="item.value"
            :icon="item.icon"
            size="sm"
            :color="formats.includes(item.value) ? 'primary' : 'neutral'"
            :variant="formats.includes(item.value) ? 'soft' : 'outline'"
            :aria-pressed="formats.includes(item.value)"
            @click="formats = toggled(formats, item.value)"
            >{{ item.label }}</UButton
          >
          <UButton
            v-for="item in networkItems"
            :key="item.value"
            :icon="item.icon"
            size="sm"
            :color="channels.includes(item.value) ? 'primary' : 'neutral'"
            :variant="channels.includes(item.value) ? 'soft' : 'outline'"
            :aria-pressed="channels.includes(item.value)"
            @click="channels = toggled(channels, item.value)"
          >
            <TikTokMark v-if="item.value === 'TikTok'" class="size-4" />{{ item.label }}
          </UButton>
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
      </div>
      <template v-if="posts.length">
        <PostsTable :posts="paginated" />
        <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" />
      </template>
      <DashboardEmpty
        v-else
        :title="t('content.noPosts')"
        :description="t('content.noPostsDescription')"
        icon="i-lucide-search-x"
      />
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
