<script setup lang="ts">
import { formatDate } from '~~/shared/utils/format'
definePageMeta({ layout: 'dashboard', middleware: 'workspace' })
useSeoMeta({ title: 'Përmbledhja · Rrit' })
const { data, base } = useWorkspace()
const { data: meta } = await useFetch('/api/meta/status', { key: 'meta-status' })
const filter = ref('review')
const postsOpen = ref(false)
const reviews = computed(() => data.value.posts.filter((p) => p.status === 'review'))
const upcoming = computed(() =>
  data.value.posts
    .filter((p) => p.status === 'scheduled')
    .sort((a, b) => (a.scheduledAt || '').localeCompare(b.scheduledAt || '')),
)
const visible = computed(() =>
  (filter.value === 'review' ? reviews.value : data.value.posts).slice(0, 6),
)
const summaries = computed(() => [
  {
    label: 'Gjithsej postime',
    value: data.value.posts.length,
    icon: 'i-lucide-files',
    to: `${base.value}/content`,
  },
  {
    label: 'Për miratim',
    value: reviews.value.length,
    icon: 'i-lucide-file-check',
    to: `${base.value}/content?status=review`,
  },
  {
    label: 'Drafte',
    value: data.value.posts.filter((p) => p.status === 'draft').length,
    icon: 'i-lucide-file-pen-line',
    to: `${base.value}/content?status=draft`,
  },
  {
    label: 'Të planifikuara',
    value: upcoming.value.length,
    icon: 'i-lucide-calendar-days',
    to: `${base.value}/calendar`,
  },
])
</script>
<template>
  <DashboardPage title="Përmbledhja" :description="`${data.brand.name} · ${data.brand.city}`">
    <template #actions
      ><UButton :to="`${base}/content/new`" variant="outline" icon="i-lucide-plus"
        >Krijo postim</UButton
      ></template
    >
    <UPageGrid class="grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-px">
      <UPageCard
        v-for="summary in summaries"
        :key="summary.label"
        :to="summary.to"
        variant="outline"
        class="lg:rounded-none lg:first:rounded-l-lg lg:last:rounded-r-lg hover:z-1"
        :ui="{ container: 'p-4 sm:p-5 gap-4' }"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs sm:text-sm text-muted">{{ summary.label }}</span>
          <UIcon :name="summary.icon" class="size-4 shrink-0 text-primary" />
        </div>
        <span class="text-3xl font-semibold text-highlighted tabular-nums">{{
          summary.value
        }}</span>
      </UPageCard>
    </UPageGrid>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <UCollapsible v-model:open="postsOpen">
        <UButton
          color="neutral"
          variant="ghost"
          block
          class="rounded-lg p-5 sm:p-6 text-left"
          :ui="{ base: 'justify-start', label: 'flex-1' }"
        >
          <template #leading
            ><UIcon name="i-lucide-file-check" class="size-5 text-muted shrink-0"
          /></template>
          <div class="flex-1 min-w-0">
            <span class="block text-sm font-semibold">Postimet për kontroll</span>
            <p class="text-sm text-muted font-normal mt-1">
              {{
                reviews.length
                  ? `${reviews.length} postime presin miratimin tënd.`
                  : 'Nuk ke postime në pritje.'
              }}
            </p>
          </div>
          <span class="text-xs sm:text-sm shrink-0">{{
            postsOpen ? 'Mbyll postimet' : 'Shiko postimet'
          }}</span>
          <template #trailing
            ><UIcon
              :name="postsOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
              class="size-4 shrink-0"
          /></template>
        </UButton>
        <template #content>
          <div class="border-t border-default">
            <div class="flex flex-wrap justify-between items-center gap-3 px-4 sm:px-5 py-3">
              <span class="text-xs text-muted"
                >{{ visible.length }} nga
                {{ filter === 'review' ? reviews.length : data.posts.length }} postime</span
              ><UTabs
                v-model="filter"
                :items="[
                  { label: 'Për miratim', value: 'review' },
                  { label: 'Të gjitha', value: 'all' },
                ]"
                :content="false"
                variant="link"
                size="sm"
                aria-label="Postimet në përmbledhje"
              />
            </div>
            <PostsTable v-if="visible.length" :posts="visible" />
            <UEmpty
              v-else
              variant="naked"
              icon="i-lucide-check-check"
              title="Nuk ka postime në pritje"
              description="Kur dërgon një postim për miratim, do ta gjesh këtu."
              :actions="[{ label: 'Krijo postim', variant: 'outline', to: `${base}/content/new` }]"
            />
            <div class="flex justify-end border-t border-default px-4 py-3">
              <UButton
                :to="`${base}/content${filter === 'review' ? '?status=review' : ''}`"
                variant="link"
                color="neutral"
                size="sm"
                trailing-icon="i-lucide-arrow-right"
                >Shiko të gjitha postimet</UButton
              >
            </div>
          </div>
        </template>
      </UCollapsible>
    </UCard>
    <UPageGrid class="grid-cols-1 lg:grid-cols-2 gap-5">
      <UCard :ui="{ body: 'p-5 sm:p-6' }">
        <div class="flex justify-between items-center gap-3 mb-5">
          <h2 class="text-sm font-semibold">Postimi i radhës në kalendar</h2>
          <UIcon name="i-lucide-calendar-days" class="size-4 text-muted" />
        </div>
        <ULink
          v-if="upcoming[0]"
          :to="`${base}/content/${upcoming[0].id}`"
          class="flex items-center gap-4 group"
        >
          <MediaImage
            :src="upcoming[0].image"
            alt=""
            width="64"
            height="64"
            class="size-16 shrink-0 rounded-md object-cover"
          />
          <div class="min-w-0 flex-1">
            <p class="text-xs text-muted mb-1.5">
              {{ formatDate(upcoming[0].scheduledAt!, data.preferences.timezone) }} ·
              {{ upcoming[0].channel }}
            </p>
            <h3 class="text-sm font-medium text-highlighted group-hover:text-primary">
              {{ upcoming[0].title }}
            </h3>
          </div>
          <UIcon name="i-lucide-arrow-up-right" class="size-4 text-muted shrink-0" />
        </ULink>
        <p v-else class="text-sm text-muted">Pasi ta miratosh një postim, zgjidh ditën dhe orën.</p>
        <UButton
          :to="`${base}/calendar`"
          variant="link"
          color="neutral"
          size="sm"
          class="mt-4 px-0"
          trailing-icon="i-lucide-arrow-right"
          >Hap kalendarin</UButton
        >
      </UCard>
      <UCard :ui="{ body: 'p-5 sm:p-6' }">
        <div class="flex justify-between items-center gap-3 mb-4">
          <h2 class="text-sm font-semibold">Facebook dhe Instagram</h2>
          <UBadge color="neutral" variant="outline" size="sm">{{
            meta?.connection?.status === 'connected' ? 'Lidhur' : 'Kërkon lidhje'
          }}</UBadge>
        </div>
        <p class="text-sm text-muted leading-relaxed max-w-lg">
          {{
            meta?.connection?.status === 'connected'
              ? 'Faqja e lidhur: ' +
                meta.connection.pageName +
                '. Përditëso postimet për të parë historikun e biznesit.'
              : 'Lidhe faqen e biznesit përmes Meta dhe lexo postimet që ke ndarë tashmë.'
          }}
        </p>
        <UButton
          :to="`${base}/social-posts`"
          variant="outline"
          color="neutral"
          size="sm"
          class="mt-5"
          trailing-icon="i-lucide-arrow-right"
          >Shiko postimet nga rrjetet</UButton
        >
      </UCard>
    </UPageGrid>
  </DashboardPage>
</template>
