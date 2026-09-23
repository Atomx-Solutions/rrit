<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'workspace' })
const { base } = useWorkspace()
const { t } = useI18n()
const { showError } = useFormFeedback()
useSeoMeta({ title: () => `${t('templates.title')} · Rrit` })
const {
  data: catalog,
  error: catalogError,
} = await useFetch('/api/templates', { key: 'post-templates' })
watch(catalogError, (value) => {
  if (value) showError(t('templates.loadError'), 'warning')
}, { immediate: true })
const available = computed(() => catalog.value || [])
const templateTextKeys: Record<string, { name: string; goal: string; industry: string }> = {
  'introduce-product': {
    name: 'templates.introduceProduct',
    goal: 'templates.productGoal',
    industry: 'templates.allIndustries',
  },
  'business-update': {
    name: 'templates.businessUpdate',
    goal: 'templates.businessGoal',
    industry: 'templates.allIndustries',
  },
}
function templateText(id: string, field: 'name' | 'goal' | 'industry', fallback: string) {
  const key = templateTextKeys[id]?.[field]
  return key ? t(key) : fallback
}
const query = ref('')
const templates = computed(() =>
  available.value.filter((t) =>
    `${templateText(t.id, 'name', t.name)} ${templateText(t.id, 'industry', t.industry)} ${templateText(t.id, 'goal', t.goal)}`
      .toLocaleLowerCase('sq')
      .includes(query.value.trim().toLocaleLowerCase('sq')),
  ),
)
const { page, pageSize, total, paginated } = usePagination(templates)
watch(query, () => {
  page.value = 1
})
</script>
<template>
  <DashboardPage
    :title="t('templates.title')"
    :description="t('templates.description')"
  >
    <template #actions
      ><UButton :to="`${base}/content/new`" color="neutral" variant="outline" icon="i-lucide-plus"
        >{{ t('templates.startFromScratch') }}</UButton
      ></template
    >
    <template #toolbar>
      <div class="flex w-full flex-wrap items-center justify-between gap-3">
        <UInput
          v-model="query"
          :placeholder="t('templates.searchPlaceholder')"
          :aria-label="t('templates.searchLabel')"
          icon="i-lucide-search"
          class="w-full sm:w-80"
        />
        <span role="status" class="text-sm text-muted"
          >{{ t('templates.count', { visible: templates.length, total: available.length }) }}</span
        >
      </div>
    </template>
    <UCard v-if="templates.length" :ui="{ body: 'p-0 sm:p-0' }">
      <div class="divide-y divide-default">
        <article v-for="template in paginated" :key="template.id" class="flex items-center gap-4 p-4 sm:p-5">
          <MediaImage
            :src="template.image"
            :alt="templateText(template.id, 'name', template.name)"
            class="size-16 sm:size-20 shrink-0 rounded-md"
            width="80"
            height="80"
          />
          <div class="min-w-0 flex-1 space-y-1.5">
            <h2 class="text-sm font-semibold">{{ templateText(template.id, 'name', template.name) }}</h2>
            <p class="text-xs sm:text-sm text-muted">{{ templateText(template.id, 'goal', template.goal) }} · {{ templateText(template.id, 'industry', template.industry) }}</p>
            <UButton
              :to="`${base}/content/new?template=${template.id}`"
              color="neutral"
              variant="link"
              size="sm"
              class="sm:hidden px-0"
              trailing-icon="i-lucide-arrow-right"
              >{{ t('templates.use') }}</UButton
            >
          </div>
          <UButton
            :to="`${base}/content/new?template=${template.id}`"
            :aria-label="t('templates.useAria', { name: templateText(template.id, 'name', template.name) })"
            color="neutral"
            variant="outline"
            trailing-icon="i-lucide-arrow-right"
            class="hidden sm:inline-flex"
            >{{ t('templates.useThis') }}</UButton
          >
        </article>
      </div>
      <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" />
    </UCard>
    <DashboardEmpty
      v-else
      :title="t('templates.noResults')"
      :description="t('templates.noResultsDescription')"
      icon="i-lucide-layout-template"
      :actions="[{ label: t('templates.clearSearch'), onClick: () => (query = '') }]"
    />
  </DashboardPage>
</template>
