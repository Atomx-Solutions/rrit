<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'workspace' })
useSeoMeta({ title: 'Modelet e postimeve · Rrit' })
const { base } = useWorkspace()
const {
  data: catalog,
  error: catalogError,
  refresh,
} = await useFetch('/api/templates', { key: 'post-templates' })
const available = computed(() => catalog.value || [])
const query = ref('')
const templates = computed(() =>
  available.value.filter((t) =>
    `${t.name} ${t.industry} ${t.goal}`
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
    title="Modelet e postimeve"
    description="Zgjidh një pikënisje. Pastaj përshtat fotografinë dhe tekstin me biznesin tënd."
  >
    <template #actions
      ><UButton :to="`${base}/content/new`" color="neutral" variant="outline" icon="i-lucide-plus"
        >Nis nga e para</UButton
      ></template
    >
    <template #toolbar>
      <div class="flex w-full flex-wrap items-center justify-between gap-3">
        <UInput
          v-model="query"
          placeholder="Kërko model ose industri..."
          aria-label="Kërko modele"
          icon="i-lucide-search"
          class="w-full sm:w-80"
        />
        <span role="status" class="text-sm text-muted"
          >{{ templates.length }} nga {{ available.length }} modele</span
        >
      </div>
    </template>
    <UAlert
      v-if="catalogError"
      color="warning"
      variant="outline"
      title="Modelet nuk mund të ngarkohen"
      :actions="[{ label: 'Provo sërish', variant: 'outline', onClick: () => refresh() }]"
    />
    <UCard v-if="templates.length" :ui="{ body: 'p-0 sm:p-0' }">
      <div class="divide-y divide-default">
        <article v-for="t in paginated" :key="t.id" class="flex items-center gap-4 p-4 sm:p-5">
          <MediaImage
            :src="t.image"
            :alt="t.name"
            class="size-16 sm:size-20 shrink-0 rounded-md"
            width="80"
            height="80"
          />
          <div class="min-w-0 flex-1 space-y-1.5">
            <h2 class="text-sm font-semibold">{{ t.name }}</h2>
            <p class="text-xs sm:text-sm text-muted">{{ t.goal }} · {{ t.industry }}</p>
            <UButton
              :to="`${base}/content/new?template=${t.id}`"
              color="neutral"
              variant="link"
              size="sm"
              class="sm:hidden px-0"
              trailing-icon="i-lucide-arrow-right"
              >Përdor modelin</UButton
            >
          </div>
          <UButton
            :to="`${base}/content/new?template=${t.id}`"
            :aria-label="`Përdor modelin: ${t.name}`"
            color="neutral"
            variant="outline"
            trailing-icon="i-lucide-arrow-right"
            class="hidden sm:inline-flex"
            >Përdor këtë model</UButton
          >
        </article>
      </div>
      <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" />
    </UCard>
    <DashboardEmpty
      v-else
      title="Nuk u gjet asnjë model"
      description="Provo një fjalë tjetër ose shiko të gjitha modelet."
      icon="i-lucide-layout-template"
      :actions="[{ label: 'Pastro kërkimin', onClick: () => (query = '') }]"
    />
  </DashboardPage>
</template>
