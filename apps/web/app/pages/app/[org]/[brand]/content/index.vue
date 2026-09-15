<script setup lang="ts">
import { statusLabels } from '~~/shared/utils/format'
definePageMeta({ layout: 'dashboard', middleware: 'workspace' })
const { data, base } = useWorkspace()
const { t } = useI18n()
useSeoMeta({ title: () => `${t('content.yourPosts')} · Rrit` })
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
const hasFilters = computed(
  () => !!search.value.trim() || filter.value !== 'all' || channel.value !== 'all',
)
function resetFilters() {
  search.value = ''
  filter.value = 'all'
  channel.value = 'all'
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
      `${p.title} ${p.caption}`
        .toLocaleLowerCase('sq')
        .includes(search.value.trim().toLocaleLowerCase('sq')),
  ),
)
const { page, pageSize, total, paginated } = usePagination(posts)
watch([search, filter, channel], () => {
  page.value = 1
})
</script>
<template>
  <DashboardPage
    :title="t('content.yourPosts')"
    :description="t('content.yourPostsDescription')"
  >
    <template #actions
      ><UButton
        :to="`${base}/templates`"
        color="neutral"
        variant="outline"
        icon="i-lucide-layout-template"
        >{{ t('nav.templates') }}</UButton
      ><UButton variant="outline" :to="`${base}/content/new`" icon="i-lucide-plus"
        >{{ t('content.createPost') }}</UButton
      ></template
    >
    <template #toolbar>
      <div class="flex w-full flex-wrap items-center justify-between gap-3">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          :placeholder="t('content.searchPlaceholder')"
          :aria-label="t('content.searchPosts')"
          class="w-full sm:w-72"
        />
        <div class="actions">
          <USelect
            v-model="channel"
            :items="[{ label: t('content.allChannels'), value: 'all' }, 'Instagram', 'Facebook']"
            :aria-label="t('content.filterChannel')"
          />
        </div>
      </div>
    </template>
    <UTabs
      v-model="filter"
      :items="tabs"
      value-key="value"
      :content="false"
      variant="link"
      class="border-b border-default"
      :ui="{ list: 'flex-wrap gap-1', trigger: 'grow-0 px-3 min-h-10' }"
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
      :actions="[{ label: t('content.createPost'), to: `${base}/content/new`, color: 'primary' }]"
    />
  </DashboardPage>
</template>
