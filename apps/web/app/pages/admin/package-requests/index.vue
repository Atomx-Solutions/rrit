<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { formatMoney } from '~~/shared/utils/format'

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
  videos_requested: number
  credits_requested: number
  message: string | null
  source: 'landing' | 'app'
  status: 'new' | 'contacted' | 'proposal_sent' | 'won' | 'lost'
  handled_note: string | null
  created_at: string
}

const statuses = ['all', 'new', 'contacted', 'proposal_sent', 'won', 'lost'] as const
const filter = ref<(typeof statuses)[number]>('all')
const toast = useToast()
function day(value: Date) {
  return value.toISOString().slice(0, 10)
}
function defaultReportRange() {
  const to = new Date()
  const from = new Date(to)
  from.setDate(1)
  return { from: day(from), to: day(to) }
}
const report = reactive(defaultReportRange())
const {
  data: conversionSummary,
  status: conversionStatus,
  error: conversionError,
  refresh: refreshConversion,
} = await useFetch<{
  total: number
  new: number
  contacted: number
  proposalSent: number
  won: number
  lost: number
  conversionValueCents: number
  conversionRate: number
}>('/api/admin/package-requests/conversion-summary', {
  lazy: true,
  query: computed(() => ({ from: report.from, to: report.to })),
})
watch(conversionError, (value) => {
  if (value) showError(t('admin.requests.conversionLoadError'))
}, { immediate: true })
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

let liveRefreshTimer: ReturnType<typeof setInterval> | undefined
let inboxSnapshotReady = false
let previousOpenCount = 0
watch(data, (value) => {
  if (!inboxSnapshotReady && value) {
    previousOpenCount = value.open_count || 0
    inboxSnapshotReady = true
  }
}, { immediate: true })
async function refreshLiveInbox() {
  if (document.visibilityState !== 'visible') return
  if (status.value === 'pending' || conversionStatus.value === 'pending') return
  await Promise.all([refresh(), refreshConversion()])
  const openCount = data.value?.open_count || 0
  if (inboxSnapshotReady && openCount > previousOpenCount) {
    toast.add({
      title: t('admin.requests.newRequestNotification'),
      description: t('admin.requests.newRequestNotificationDescription', { count: openCount - previousOpenCount }),
      color: 'info',
    })
  }
  previousOpenCount = openCount
}
onMounted(() => {
  liveRefreshTimer = setInterval(() => { void refreshLiveInbox() }, 5000)
  window.addEventListener('focus', refreshLiveInbox)
})
onBeforeUnmount(() => {
  if (liveRefreshTimer) clearInterval(liveRefreshTimer)
  window.removeEventListener('focus', refreshLiveInbox)
})

// The status goes to the API because it decides which rows are fetched; the
// rest filters what is already here, so typing costs no round trip.
const sources = ['all', 'landing', 'app'] as const
// What the request asks for. A request may carry both, so it counts as a post
// request and as a credit request at the same time.
const kinds = ['all', 'posts', 'videos', 'credits'] as const
const search = reactive({
  text: '',
  source: 'all' as (typeof sources)[number],
  kind: 'all' as (typeof kinds)[number],
  from: '',
  to: '',
})
const hasFilters = computed(() =>
  filter.value !== 'all'
  || !!search.text.trim()
  || search.source !== 'all'
  || search.kind !== 'all'
  || !!search.from
  || !!search.to,
)
function clearFilters() {
  filter.value = 'all'
  Object.assign(search, { text: '', source: 'all', kind: 'all', from: '', to: '' })
}
async function resetAndRefresh() {
  const nextReport = defaultReportRange()
  const listNeedsRefresh = filter.value !== 'all'
    || !!search.text
    || search.source !== 'all'
    || search.kind !== 'all'
    || !!search.from
    || !!search.to
  const summaryNeedsRefresh = report.from !== nextReport.from || report.to !== nextReport.to
  filter.value = 'all'
  page.value = 1
  pageSize.value = 20
  Object.assign(search, { text: '', source: 'all', from: '', to: '' })
  Object.assign(report, nextReport)
  // Filter/date changes are watched by useFetch and already trigger a refresh.
  // Only call refresh explicitly when that query did not change, avoiding two
  // concurrent requests and the resulting aborted-request error toasts.
  await nextTick()
  const requestsToRefresh = [
    ...(listNeedsRefresh ? [] : [refresh()]),
    ...(summaryNeedsRefresh ? [] : [refreshConversion()]),
  ]
  await Promise.all(requestsToRefresh)
}
const requests = computed(() => {
  const text = search.text.trim().toLowerCase()
  const from = search.from ? Date.parse(`${search.from}T00:00:00.000Z`) : null
  // The end of the chosen day, so a request sent that afternoon still matches.
  const to = search.to ? Date.parse(`${search.to}T23:59:59.999Z`) : null
  return (data.value?.requests || []).filter((request) => {
    if (search.source !== 'all' && request.source !== search.source) return false
    if (search.kind === 'posts' && request.posts_requested < 1) return false
    if (search.kind === 'videos' && (request.videos_requested ?? 0) < 1) return false
    if (search.kind === 'credits' && request.credits_requested < 1) return false
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
const page = ref(1)
const pageSize = ref(20)
const paginatedRequests = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return requests.value.slice(start, start + pageSize.value)
})
watch(
  [filter, () => search.text, () => search.source, () => search.from, () => search.to, pageSize],
  () => { page.value = 1 },
)
watch(() => requests.value.length, (total) => {
  const lastPage = Math.max(1, Math.ceil(total / pageSize.value))
  if (page.value > lastPage) page.value = lastPage
})

const statusColors: Record<PackageRequest['status'], 'info' | 'warning' | 'success' | 'neutral'> = {
  new: 'info',
  contacted: 'warning',
  proposal_sent: 'warning',
  won: 'success',
  lost: 'neutral',
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
async function setStatus(request: PackageRequest, next: PackageRequest['status'], note?: string) {
  saving.value = request.id
  try {
    const updated = await $fetch<Partial<PackageRequest>>(
      `/api/admin/package-requests/${request.id}`,
      { method: 'PATCH', body: { status: next, note } },
    )
    toast.add({ title: t('admin.requests.saved'), color: 'success' })
    // Update only the existing reactive records. Replacing `selected` or the
    // entire response object remounted the modal's contents after each click,
    // which looked like a full reload and could interrupt text being entered.
    if (selected.value?.id === request.id)
      Object.assign(selected.value, updated, { status: next })
    const row = data.value?.requests.find(item => item.id === request.id)
    if (row) Object.assign(row, updated, { status: next })
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
// A request for credits alone is answered with a credit proposal, which has no
// post count, no per-post rate and no period of its own. Mixed requests keep
// the package form, because they are still selling a package.
// Each kind of request is answered by its own proposal, so a request opens the
// one form that matches what it actually asked for and no other. Posts take
// priority when a landing lead asked for posts and videos in the same request:
// that proposal carries the posts, and the videos are sold as a second one.
const convertingPackage = computed(() =>
  converting.value && converting.value.posts_requested > 0 ? converting.value : null,
)
const convertingVideos = computed(() =>
  converting.value
  && converting.value.posts_requested === 0
  && (converting.value.videos_requested ?? 0) > 0
    ? converting.value
    : null,
)
const convertingCredits = computed(() =>
  converting.value
  && converting.value.posts_requested === 0
  && (converting.value.videos_requested ?? 0) === 0
    ? converting.value
    : null,
)
async function onConverted() {
  converting.value = null
  selected.value = null
  await refresh()
}

const columns = computed<TableColumn<PackageRequest>[]>(() => [
  { id: 'contact', header: t('admin.requests.contact') },
  { id: 'posts', header: t('admin.requests.requested') },
  { id: 'source', header: t('admin.requests.source') },
  { id: 'created', header: t('admin.requests.created') },
  { id: 'status', header: t('admin.details.status') },
  { id: 'actions', header: '', meta: { class: { td: 'text-end' } } },
])
</script>
<template>
  <AdminPage :title="t('admin.nav.packageRequests')">
    <UCard class="shrink-0" :ui="{ header: 'px-4 py-3 sm:px-5', body: 'px-4 py-4 sm:px-5' }">
      <template #header>
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 class="text-sm font-semibold">{{ t('admin.requests.conversionTitle') }}</h2>
            <p class="mt-0.5 text-xs text-muted">{{ t('admin.requests.conversionDescription') }}</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <UFormField :label="t('admin.requests.kind')" class="w-40">
            <USelect
              v-model="search.kind"
              :items="kinds.map(value => ({ label: t(`admin.requests.kindFilter.${value}`), value }))"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="t('admin.requests.from')" class="w-38">
              <UInput v-model="report.from" type="date" :max="report.to" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.requests.to')" class="w-38">
              <UInput v-model="report.to" type="date" :min="report.from" class="w-full" />
            </UFormField>
          </div>
        </div>
      </template>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div
          v-for="item in [
            ['total', t('admin.requests.conversionTotal')],
            ['contacted', t('admin.requests.status.contacted')],
            ['proposalSent', t('admin.requests.status.proposal_sent')],
            ['won', t('admin.requests.status.won')],
            ['lost', t('admin.requests.status.lost')],
          ] as const"
          :key="item[0]"
          class="rounded-lg border border-default px-3 py-2.5"
        >
          <p class="text-xs text-muted">{{ item[1] }}</p>
          <p class="mt-1 text-lg font-semibold tabular-nums">{{ conversionSummary?.[item[0]] ?? 0 }}</p>
        </div>
        <div class="rounded-lg border border-default px-3 py-2.5">
          <p class="text-xs text-muted">{{ t('admin.requests.conversionRate') }}</p>
          <p class="mt-1 text-lg font-semibold tabular-nums">{{ conversionSummary?.conversionRate?.toFixed(1) ?? '0.0' }}%</p>
        </div>
        <div class="rounded-lg border border-default px-3 py-2.5">
          <p class="text-xs text-muted">{{ t('admin.requests.conversionValue') }}</p>
          <p class="mt-1 text-lg font-semibold tabular-nums">{{ formatMoney((conversionSummary?.conversionValueCents ?? 0) / 100) }}</p>
        </div>
      </div>
    </UCard>
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
            :loading="status === 'pending' || conversionStatus === 'pending'"
            :aria-label="t('admin.requests.refresh')"
            @click="resetAndRefresh"
          />
        </div>
      </template>
    </UCard>
    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <UTable
        :data="paginatedRequests"
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
          <p v-if="row.original.posts_requested > 0">{{ t('admin.requests.postsValue', { count: row.original.posts_requested }) }}</p>
          <p v-if="(row.original.videos_requested ?? 0) > 0">{{ t('admin.requests.videosValue', { count: row.original.videos_requested }) }}</p>
          <p v-if="row.original.credits_requested > 0">{{ t('admin.packages.creditsValue', { count: row.original.credits_requested }) }}</p>
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
    <template #footer>
      <ListPagination
        v-model:page="page"
        v-model:page-size="pageSize"
        :total="requests.length"
        :sibling-count="1"
        show-edges
      />
    </template>
    <AdminPackageRequestDetails
      :request="selected"
      :saving="saving === selected?.id"
      @close="selected = null"
      @status="(next, note) => {
        if (!selected) return
        if (next === 'won') converting = selected
        else setStatus(selected, next, note)
      }"
      @remove="() => { if (selected) removeRequest(selected) }"
    />
    <AdminPackageRequestConvert
      :request="convertingPackage"
      @close="converting = null"
      @done="onConverted"
    />
    <AdminVideoRequestConvert
      :request="convertingVideos"
      @close="converting = null"
      @done="onConverted"
    />
    <AdminCreditRequestConvert
      :request="convertingCredits"
      @close="converting = null"
      @done="onConverted"
    />
  </AdminPage>
</template>
