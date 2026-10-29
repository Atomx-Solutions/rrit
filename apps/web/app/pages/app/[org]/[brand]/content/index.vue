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
// Format and network wait in a side panel; the button names how many are set.
const filtersOpen = ref(false)
// Short labels with an icon each; the panel's headings say what they filter.
const formatItems = computed(() => [
  { label: t('content.filterAll'), value: 'all' as const, icon: 'i-lucide-layers' },
  { label: t('content.filterPosts'), value: 'post' as const, icon: 'i-lucide-image' },
  { label: t('content.filterVideos'), value: 'video' as const, icon: 'i-lucide-circle-play' },
])
const networkIcons: Record<string, string> = { Facebook: 'i-lucide-facebook', Instagram: 'i-lucide-instagram' }
const networkItems = computed(() => [
  { label: t('content.filterAll'), value: 'all', icon: 'i-lucide-globe' },
  ...postSchema.shape.channel.options.map((value) => ({ label: value, value, icon: networkIcons[value] })),
])
const activeFilterCount = computed(() => (format.value !== 'all' ? 1 : 0) + (channel.value !== 'all' ? 1 : 0))
function clearPanelFilters() {
  format.value = 'all'
  channel.value = 'all'
}
const posts = computed(() =>
  data.value.posts.filter(
    (p) =>
      inTab(p, filter.value) &&
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
    <template #toolbar>
      <div class="flex w-full items-center gap-2 sm:gap-3">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          :placeholder="t('content.searchPlaceholder')"
          :aria-label="t('content.searchPosts')"
          class="min-w-0 flex-1 sm:w-72 sm:flex-none"
        />
        <UButton
          variant="outline"
          icon="i-lucide-sliders-horizontal"
          class="shrink-0 sm:ml-auto"
          :aria-label="t('content.filters')"
          @click="filtersOpen = true"
        >
          <span class="hidden sm:inline">{{ t('content.filters') }}</span>
          <UBadge v-if="activeFilterCount" size="sm" color="primary" variant="solid">{{ activeFilterCount }}</UBadge>
        </UButton>
        <UButton
          :to="`${base}/monthly-planner`"
          variant="outline"
          icon="i-lucide-plus"
          :label="t('content.createPost')"
          class="shrink-0"
        />
      </div>
    </template>
    <USlideover v-model:open="filtersOpen" :title="t('content.filters')" :ui="{ content: 'max-w-sm' }">
      <template #body>
        <div class="space-y-6">
          <fieldset class="space-y-2">
            <legend class="mb-2 text-sm font-semibold text-highlighted">{{ t('content.formatHeading') }}</legend>
            <div class="flex flex-wrap gap-2">
              <UButton
                v-for="item in formatItems"
                :key="item.value"
                :icon="item.icon"
                size="sm"
                :color="format === item.value ? 'primary' : 'neutral'"
                :variant="format === item.value ? 'soft' : 'outline'"
                :aria-pressed="format === item.value"
                @click="format = item.value"
                >{{ item.label }}</UButton
              >
            </div>
          </fieldset>
          <fieldset class="space-y-2">
            <legend class="mb-2 text-sm font-semibold text-highlighted">{{ t('content.networkHeading') }}</legend>
            <div class="flex flex-wrap gap-2">
              <UButton
                v-for="item in networkItems"
                :key="item.value"
                :icon="item.icon"
                size="sm"
                :color="channel === item.value ? 'primary' : 'neutral'"
                :variant="channel === item.value ? 'soft' : 'outline'"
                :aria-pressed="channel === item.value"
                @click="channel = item.value"
              >
                <TikTokMark v-if="item.value === 'TikTok'" class="size-4" />{{ item.label }}
              </UButton>
            </div>
          </fieldset>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full gap-2">
          <UButton color="neutral" variant="outline" class="flex-1 justify-center" :disabled="!activeFilterCount" @click="clearPanelFilters">{{ t('content.clearFilters') }}</UButton>
          <UButton class="flex-1 justify-center" @click="filtersOpen = false">{{ t('content.showResults', { count: posts.length }) }}</UButton>
        </div>
      </template>
    </USlideover>
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
