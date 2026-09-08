<script setup lang="ts">
import { statusLabels } from '~~/shared/utils/format'
definePageMeta({ layout: 'dashboard', middleware: 'workspace' })
useSeoMeta({ title: 'Studio e përmbajtjes · Rrit' })
const { data, base } = useWorkspace()
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
const tabs = [
  { value: 'all', label: 'Të gjitha' },
  ...Object.entries(statusLabels).map(([value, label]) => ({ value, label })),
]
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
    title="Postimet e tua"
    description="Krijo një postim, kontrolloje dhe zgjidh kur do të publikohet."
  >
    <template #actions
      ><UButton
        :to="`${base}/templates`"
        color="neutral"
        variant="outline"
        icon="i-lucide-layout-template"
        >Modelet</UButton
      ><UButton variant="outline" :to="`${base}/content/new`" icon="i-lucide-plus"
        >Krijo postim</UButton
      ></template
    >
    <template #toolbar>
      <div class="flex w-full flex-wrap items-center justify-between gap-3">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          placeholder="Kërko një postim..."
          aria-label="Kërko postime"
          class="w-full sm:w-72"
        />
        <div class="actions">
          <USelect
            v-model="channel"
            :items="[{ label: 'Të gjitha kanalet', value: 'all' }, 'Instagram', 'Facebook']"
            aria-label="Filtro sipas kanalit"
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
        {{ posts.length }} nga {{ data.posts.length }} postime
      </p>
      <UButton
        v-if="hasFilters"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-x"
        @click="resetFilters"
        >Pastro filtrat</UButton
      >
    </div>
    <UCard v-if="posts.length" as="div" :ui="{ body: 'p-0 sm:p-0' }" class="table-wrap">
      <PostsTable :posts="paginated" />
      <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" />
    </UCard>
    <DashboardEmpty
      v-else
      title="Nuk u gjet asnjë postim"
      description="Provo një kërkim tjetër ose krijo postimin tënd të parë."
      icon="i-lucide-search-x"
      :actions="[{ label: 'Krijo postim', to: `${base}/content/new`, color: 'primary' }]"
    />
  </DashboardPage>
</template>
