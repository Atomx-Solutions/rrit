<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

definePageMeta({ layout: 'admin', middleware: 'superadmin' })
const { t } = useI18n()
const { showError } = useFormFeedback()
useSeoMeta({
  title: () => `${t('admin.nav.packageRequests')} · Rrit Admin`,
  robots: 'noindex, nofollow',
})

type PackageRequest = {
  id: string
  organization_id: string | null
  organization_name: string | null
  contact_name: string
  contact_email: string
  phone: string | null
  business_name: string | null
  industry: string | null
  platform: 'instagram' | 'facebook' | 'both' | null
  posts_requested: number
  message: string | null
  source: 'landing' | 'app'
  status: 'new' | 'contacted' | 'converted' | 'declined'
  handled_note: string | null
  created_at: string
}

const statuses = ['all', 'new', 'contacted', 'converted', 'declined'] as const
const filter = ref<(typeof statuses)[number]>('all')
const toast = useToast()
const { data, status, error, refresh } = await useFetch<{
  open_count: number
  requests: PackageRequest[]
}>('/api/admin/package-requests', {
  lazy: true,
  query: computed(() => (filter.value === 'all' ? {} : { status: filter.value })),
})
watch(
  error,
  (value) => {
    if (value) showError(t('admin.requests.loadError'))
  },
  { immediate: true },
)
// The status goes to the API because it decides which rows are fetched; the
// rest filters what is already here, so typing costs no round trip.
const sources = ['all', 'landing', 'app'] as const
const search = reactive({ text: '', source: 'all' as (typeof sources)[number], from: '', to: '' })
const hasFilters = computed(() =>
  filter.value !== 'all'
  || !!search.text.trim()
  || search.source !== 'all'
  || !!search.from
  || !!search.to,
)
function clearFilters() {
  filter.value = 'all'
  Object.assign(search, { text: '', source: 'all', from: '', to: '' })
}
const requests = computed(() => {
  const text = search.text.trim().toLowerCase()
  const from = search.from ? Date.parse(`${search.from}T00:00:00.000Z`) : null
  // The end of the chosen day, so a request sent that afternoon still matches.
  const to = search.to ? Date.parse(`${search.to}T23:59:59.999Z`) : null
  return (data.value?.requests || []).filter((request) => {
    if (search.source !== 'all' && request.source !== search.source) return false
    const sent = Date.parse(request.created_at)
    if (from !== null && sent < from) return false
    if (to !== null && sent > to) return false
    if (!text) return true
    return [
      request.contact_name,
      request.contact_email,
      request.phone,
      request.business_name,
      request.organization_name,
      request.industry,
    ].some(value => value?.toLowerCase().includes(text))
  })
})

const statusColors: Record<PackageRequest['status'], 'info' | 'warning' | 'success' | 'neutral'> = {
  new: 'info',
  contacted: 'warning',
  converted: 'success',
  declined: 'neutral',
}
function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('sq-XK', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Europe/Belgrade',
  }).format(new Date(value))
}

// The row shows enough to triage; the panel shows the whole request. The panel
// holds its own copy, so a request that leaves the current filter after being
// answered stays open and readable instead of vanishing mid-decision.
const selected = ref<PackageRequest | null>(null)

const saving = ref('')
async function setStatus(request: PackageRequest, next: PackageRequest['status']) {
  saving.value = request.id
  try {
    const updated = await $fetch<Partial<PackageRequest>>(
      `/api/admin/package-requests/${request.id}`,
      { method: 'PATCH', body: { status: next } },
    )
    toast.add({ title: t('admin.requests.saved'), color: 'success' })
    // The answer carries the stored row, so the panel shows the new status
    // without waiting for the list to come back.
    if (selected.value?.id === request.id)
      selected.value = { ...selected.value, ...updated, status: next }
    await refresh()
  } catch (problem) {
    showError(
      (problem as { data?: { message?: string } }).data?.message || t('admin.requests.saveFailed'),
    )
  } finally {
    saving.value = ''
  }
}

async function removeRequest(request: PackageRequest) {
  saving.value = request.id
  try {
    // The same-origin guard requires a JSON request, so the empty body is what
    // carries the content type rather than a payload the endpoint reads.
    await $fetch(`/api/admin/package-requests/${request.id}`, { method: 'DELETE', body: {} })
    toast.add({ title: t('admin.requests.deleted'), color: 'success' })
    selected.value = null
    await refresh()
  }
  catch (problem) {
    showError(
      (problem as { data?: { message?: string } }).data?.message || t('admin.requests.deleteFailed'),
    )
  }
  finally {
    saving.value = ''
  }
}

// Marking a request answered is where the agreed package gets written, so the
// status is set by that dialog rather than on its own.
const converting = ref<PackageRequest | null>(null)
async function onConverted() {
  converting.value = null
  selected.value = null
  await refresh()
}

const columns = computed<TableColumn<PackageRequest>[]>(() => [
  { id: 'contact', header: t('admin.requests.contact') },
  { id: 'posts', header: t('admin.requests.posts') },
  { id: 'source', header: t('admin.requests.source') },
  { id: 'created', header: t('admin.requests.created') },
  { id: 'status', header: t('admin.details.status') },
  { id: 'actions', header: '', meta: { class: { td: 'text-end' } } },
])
</script>
<template>
  <AdminPage :title="t('admin.nav.packageRequests')">
    <UCard class="shrink-0" :ui="{ header: 'px-4 py-3 sm:px-5', body: 'p-0 sm:p-0' }">
      <template #header>
        <div class="flex flex-wrap items-end gap-3">
          <UFormField :label="t('admin.requests.searchLabel')" class="w-56">
            <UInput
              v-model="search.text"
              icon="i-lucide-search"
              :placeholder="t('admin.requests.searchPlaceholder')"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="t('admin.details.status')" class="w-44">
            <USelect
              v-model="filter"
              :items="statuses.map(value => ({ label: t(`admin.requests.filter.${value}`), value }))"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="t('admin.requests.source')" class="w-44">
            <USelect
              v-model="search.source"
              :items="sources.map(value => ({ label: t(`admin.requests.sourceFilter.${value}`), value }))"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="t('admin.requests.from')" class="w-38">
            <UInput v-model="search.from" type="date" :max="search.to || undefined" class="w-full" />
          </UFormField>
          <UFormField :label="t('admin.requests.to')" class="w-38">
            <UInput v-model="search.to" type="date" :min="search.from || undefined" class="w-full" />
          </UFormField>
          <UButton
            v-if="hasFilters"
            icon="i-lucide-x"
            color="neutral"
            variant="outline"
            :label="t('admin.requests.clearFilters')"
            @click="clearFilters"
          />
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            :loading="status === 'pending'"
            :aria-label="t('admin.requests.refresh')"
            @click="refresh()"
          />
        </div>
      </template>
    </UCard>
    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <UTable
        :data="requests"
        :columns="columns"
        :loading="status === 'pending'"
        :empty="t('admin.requests.empty')"
      >
        <template #contact-cell="{ row }">
          <div
            class="space-y-0.5 cursor-pointer"
            role="button"
            tabindex="0"
            @click="selected = row.original"
            @keydown.enter="selected = row.original"
          >
            <p class="font-medium">
              {{ row.original.contact_name }}
            </p>
            <p class="text-xs text-muted">
              {{ row.original.contact_email
              }}<template v-if="row.original.phone"> · {{ row.original.phone }}</template>
            </p>
            <p v-if="row.original.organization_name || row.original.business_name" class="text-xs text-muted">
              {{ row.original.organization_name || row.original.business_name
              }}<template v-if="row.original.industry"> · {{ row.original.industry }}</template>
            </p>
            <p v-if="row.original.message" class="text-xs text-muted italic">
              {{ row.original.message }}
            </p>
          </div>
        </template>
        <template #posts-cell="{ row }">
          <p>{{ t('admin.requests.postsValue', { count: row.original.posts_requested }) }}</p>
          <p v-if="row.original.platform" class="text-xs text-muted">
            {{ t(`admin.requests.platform.${row.original.platform}`) }}
          </p>
        </template>
        <template #source-cell="{ row }">
          {{ t(`admin.requests.sourceValue.${row.original.source}`) }}
        </template>
        <template #created-cell="{ row }">
          {{ formatDateTime(row.original.created_at) }}
        </template>
        <template #status-cell="{ row }">
          <UBadge
            :color="statusColors[row.original.status]"
            variant="subtle"
            :label="t(`admin.requests.status.${row.original.status}`)"
          />
        </template>
        <template #actions-cell="{ row }">
          <UButton
            icon="i-lucide-chevron-right"
            color="neutral"
            variant="ghost"
            size="xs"
            :aria-label="t('admin.requests.openRequest', { name: row.original.contact_name })"
            @click="selected = row.original"
          />
        </template>
      </UTable>
    </UCard>
    <AdminPackageRequestDetails
      :request="selected"
      :saving="saving === selected?.id"
      @close="selected = null"
      @status="(next) => {
        if (!selected) return
        if (next === 'converted') converting = selected
        else setStatus(selected, next)
      }"
      @remove="() => { if (selected) removeRequest(selected) }"
    />
    <AdminPackageRequestConvert
      :request="converting"
      @close="converting = null"
      @done="onConverted"
    />
  </AdminPage>
</template>
