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
    <!-- Search, channel and the action share one row on a phone instead of
         taking two. Only the button's label can give way: at 375px the three
         full labels need more width than the screen has. `hidden` also takes
         the text out of the accessibility tree, so the icon carries its name
         through aria-label. -->
    <!-- Goes to AI planning: a post starts by generating it there. -->
    <template #actions>
      <UButton
        variant="outline"
        :to="`${base}/monthly-planner`"
        icon="i-lucide-plus"
        :label="t('content.createPost')"
        :aria-label="t('content.createPost')"
        :ui="{ label: 'hidden sm:inline' }"
      />
    </template>
    <template #toolbar>
      <div class="flex w-full items-center gap-2 sm:justify-between sm:gap-3">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          :placeholder="t('content.searchPlaceholder')"
          :aria-label="t('content.searchPosts')"
          class="min-w-0 flex-1 sm:w-72 sm:flex-none"
        />
        <div class="actions shrink-0">
          <USelect
            v-model="channel"
            :items="[{ label: t('content.allChannels'), value: 'all' }, 'Instagram', 'Facebook']"
            :aria-label="t('content.filterChannel')"
            class="w-32 sm:w-auto"
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
        list: 'gap-1 flex-nowrap overflow-x-auto sm:flex-wrap sm:overflow-x-visible',
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
      :actions="[{ label: t('content.createPost'), to: `${base}/content/new`, color: 'primary' }]"
    />
  </DashboardPage>
</template>
