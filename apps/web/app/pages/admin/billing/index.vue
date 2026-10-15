<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

definePageMeta({ layout: 'admin', middleware: 'superadmin' })
const { t } = useI18n()
const { showError, showSuccess } = useFormFeedback()
useSeoMeta({ title: () => `${t('admin.nav.billing')} · Framic Admin`, robots: 'noindex, nofollow' })

type Invoice = {
  id: string
  number: string
  kind: 'invoice' | 'credit_note'
  status: string
  issued_at: string
  organization_id: string
  organization_name: string
  total_cents: number
  subtotal_cents: number
  vat_cents: number
  source_type: string
  currency: string
  lines: unknown[]
  payment_status: PaymentStatus | null
  due_at: string | null
  paid_at: string | null
  payment_method: PaymentMethod | null
  payment_note: string | null
}

type PaymentStatus = 'paid' | 'unpaid' | 'overdue' | 'credited'
type PaymentMethod = 'cash' | 'bank_transfer' | 'card' | 'other'

type BillingResponse = {
  invoices: Invoice[]
  summary: {
    total_revenue_cents: number
    total_credit_notes_cents: number
    gross_revenue_cents: number
    net_revenue_cents: number
    vat_cents: number
    outstanding_cents: number
    overdue_cents: number
    this_month_cents: number
    this_month_net_cents: number
  }
  total: number
  page: number
  // The server converts every invoice's own currency into this one.
  summary_currency: 'CHF' | 'EUR'
}

const today = new Date().toISOString().slice(0, 10)
const page = ref(1)
const pageSize = ref(20)

// Date filters go to the API
const dateFilters = reactive({ from: '', to: '' })
// Text filters are client-side (fast, no extra round trip for short lists)
// A package invoice and a credit top-up are both sold through the same
// proposal flow, so the list separates them by what was actually bought.
const sourceKinds = ['all', 'custom_package', 'video_purchase', 'credit_top_up'] as const
const search = reactive({ number: '', source: 'all' as (typeof sourceKinds)[number] })

// The page opens on the organizations that have invoices; choosing one lists
// only its invoices, with totals and filters for that organization alone.
const route = useRoute()
const selectedOrgId = computed(() => (typeof route.query.org === 'string' ? route.query.org : null))
type BillingOrganization = {
  organization_id: string
  organization_name: string
  invoice_count: number
  overdue_count: number
  last_issued_at: string | null
  gross_revenue_cents: number
  outstanding_cents: number
  overdue_cents: number
}
const { data: organizationsData, status: organizationsStatus, refresh: refreshOrganizations } = await useFetch<{
  organizations: BillingOrganization[]
  currency: 'CHF' | 'EUR'
}>('/api/admin/billing/organizations', { lazy: true, key: 'admin-billing-organizations' })
const orgSearch = ref('')
const organizations = computed(() => {
  const term = orgSearch.value.trim().toLowerCase()
  return (organizationsData.value?.organizations ?? [])
    .filter(org => !term || org.organization_name.toLowerCase().includes(term))
})
const selectedOrgName = computed(() =>
  organizationsData.value?.organizations.find(org => org.organization_id === selectedOrgId.value)?.organization_name
  ?? data.value?.invoices[0]?.organization_name
  ?? '')
function openOrganization(org: BillingOrganization) {
  page.value = 1
  void navigateTo({ query: { ...route.query, org: org.organization_id } })
}
function backToOrganizations() {
  const { org: _org, ...query } = route.query
  void navigateTo({ query })
}
watch(selectedOrgId, () => { page.value = 1 })
// Payment state is filtered by the API, so the outstanding totals and the
// page count describe the same invoices the table shows.
const paymentFilters = ['all', 'unpaid', 'overdue', 'paid'] as const
const paymentFilter = ref<(typeof paymentFilters)[number]>('all')

watch([() => dateFilters.from, () => dateFilters.to, paymentFilter], () => { page.value = 1 })

const query = computed(() => ({
  ...(selectedOrgId.value ? { org_id: selectedOrgId.value } : {}),
  page: page.value,
  per_page: pageSize.value,
  ...(dateFilters.from ? { from: dateFilters.from } : {}),
  ...(dateFilters.to ? { to: dateFilters.to } : {}),
  ...(paymentFilter.value !== 'all' ? { payment: paymentFilter.value } : {}),
}))

const { data, status, error, refresh } = await useFetch<BillingResponse>('/api/admin/billing/invoices', {
    // Open the page at once and show loading inside it, instead of blocking navigation.
    lazy: true,
  key: 'admin-billing-invoices',
  query,
})
watch(error, (value) => {
  if (value) showError(t('admin.billing.loadError'))
}, { immediate: true })

// Client-side search on top of the API page
const invoices = computed(() => {
  const list = data.value?.invoices ?? []
  const num = search.number.trim().toLowerCase()
  return list.filter(inv =>
    (!num || inv.number.toLowerCase().includes(num))
    && (search.source === 'all' || inv.source_type === search.source),
  )
})

const formatCents = (cents: number, currency = 'EUR') =>
  new Intl.NumberFormat('sq-XK', {
    style: 'currency',
    currency: currency === 'CHF' ? 'CHF' : 'EUR',
    minimumFractionDigits: 2,
  }).format(cents / 100)
const formatSummaryCents = (cents: number) => formatCents(cents, data.value?.summary_currency)
// Invoices show the purchase time, to the second.
const formatDate = (value: string) =>
  new Intl.DateTimeFormat('sq-XK', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Belgrade' }).format(new Date(value))

const summary = computed(() => data.value?.summary)
const summaryTiles = computed(() => {
  const s = summary.value
  if (!s) return []
  return [
    // All after credit notes: gross includes VAT, net excludes it.
    { label: t('admin.billing.grossRevenue'), value: formatSummaryCents(s.gross_revenue_cents), icon: 'i-lucide-receipt' },
    { label: t('admin.billing.netRevenue'), value: formatSummaryCents(s.net_revenue_cents), icon: 'i-lucide-trending-up' },
    { label: t('admin.billing.vat'), value: formatSummaryCents(s.vat_cents), icon: 'i-lucide-landmark' },
    { label: t('admin.billing.payment.outstanding'), value: formatSummaryCents(s.outstanding_cents), icon: 'i-lucide-hourglass' },
    { label: t('admin.billing.payment.overdueTotal'), value: formatSummaryCents(s.overdue_cents), icon: 'i-lucide-alert-triangle' },
  ]
})

const hasFilters = computed(() =>
  !!(dateFilters.from || dateFilters.to || search.number)
  || search.source !== 'all' || paymentFilter.value !== 'all',
)
function clearFilters() {
  dateFilters.from = ''
  dateFilters.to = ''
  search.number = ''
  search.source = 'all'
  paymentFilter.value = 'all'
}

const paymentColor: Record<PaymentStatus, 'success' | 'warning' | 'error' | 'neutral'> = {
  paid: 'success',
  unpaid: 'warning',
  overdue: 'error',
  credited: 'neutral',
}
const formatDay = (value: string) =>
  new Intl.DateTimeFormat('sq-XK', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Belgrade' }).format(new Date(value))

const paymentMethods: PaymentMethod[] = ['bank_transfer', 'cash', 'card', 'other']
const paying = ref<Invoice | null>(null)
const paymentForm = reactive({ paid_at: today, method: 'bank_transfer' as PaymentMethod, note: '' })
// Only the row being saved shows a spinner; the others stay usable.
const savingPayment = ref<string | null>(null)
function openPayment(inv: Invoice) {
  paymentForm.paid_at = today
  paymentForm.method = 'bank_transfer'
  paymentForm.note = ''
  paying.value = inv
}
async function savePayment(inv: Invoice, body: Record<string, unknown>, successKey: string) {
  savingPayment.value = inv.id
  try {
    await $fetch(`/api/admin/billing/invoices/${inv.id}/payment`, { method: 'PATCH', body })
    showSuccess(t(successKey, { number: inv.number }))
    paying.value = null
    await Promise.all([refresh(), refreshOrganizations()])
  } catch {
    showError(t('admin.billing.payment.saveError'))
  } finally {
    savingPayment.value = null
  }
}
function markPaid() {
  if (!paying.value) return
  const note = paymentForm.note.trim()
  void savePayment(paying.value, {
    status: 'paid',
    paid_at: paymentForm.paid_at,
    method: paymentForm.method,
    ...(note ? { note } : {}),
  }, 'admin.billing.payment.markedPaid')
}
function markUnpaid(inv: Invoice) {
  void savePayment(inv, { status: 'unpaid' }, 'admin.billing.payment.markedUnpaid')
}

const preview = ref<Invoice | null>(null)
function pdfUrl(inv: Invoice, inline: boolean) {
  return `/api/admin/organizations/${inv.organization_id}/invoices/${inv.id}/pdf${inline ? '?inline=1' : ''}`
}

const tableUi = {
  root: 'w-full',
  base: 'w-full border-separate border-spacing-0',
  thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
  th: 'py-2.5 px-4 text-xs font-medium',
  td: 'px-4 py-2.5 border-b border-default text-sm',
  tbody: '[&>tr]:last:[&>td]:border-b-0',
  separator: 'h-0',
}

const wide = { class: { th: 'hidden lg:table-cell', td: 'hidden lg:table-cell' } }
const endAligned = { class: { td: 'text-end', th: 'text-end' } }

const organizationColumns = computed<TableColumn<BillingOrganization>[]>(() => [
  { id: 'organization', header: t('admin.billing.organization') },
  { id: 'invoices', header: t('admin.billing.orgs.invoices'), meta: endAligned },
  { id: 'gross', header: t('admin.billing.grossRevenue'), meta: endAligned },
  { id: 'outstanding', header: t('admin.billing.payment.outstanding'), meta: endAligned },
  { id: 'last', header: t('admin.billing.orgs.lastInvoice'), meta: wide },
  { id: 'open', header: '', meta: endAligned },
])
const organizationCurrency = computed(() => organizationsData.value?.currency ?? 'CHF')


const columns = computed<TableColumn<Invoice>[]>(() => [
  { accessorKey: 'number', header: t('admin.billing.number') },
  { id: 'kind', header: t('admin.billing.kind'), meta: wide },
  { id: 'source', header: t('admin.billing.filterSource'), meta: wide },
  { id: 'issued_at', header: t('admin.billing.issuedAt') },
  { id: 'payment', header: t('admin.billing.payment.column') },
  { id: 'total', header: t('admin.billing.total'), meta: endAligned },
  { id: 'actions', header: '', meta: endAligned },
])

const sourceLabel: Record<string, string> = {
  subscription_activation: t('admin.billing.sourceSubscriptionActivation'),
  subscription_upgrade: t('admin.billing.sourceSubscriptionUpgrade'),
  credit_top_up: t('admin.billing.sourceCreditTopUp'),
  credit_note: t('admin.billing.sourceCreditNote'),
  custom_package: t('admin.billing.sourceCustomPackage'),
  video_purchase: t('admin.billing.sourceVideoPurchase'),
}
</script>

<template>
  <AdminPage :title="t('admin.nav.billing')">
    <!-- Organizations with invoices -->
    <UCard v-if="!selectedOrgId" class="shrink-0" :ui="{ header: 'px-4 py-3 sm:px-5', body: 'p-0 sm:p-0' }">
      <template #header>
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 class="text-sm font-semibold">{{ t('admin.billing.orgs.title') }}</h2>
            <p class="text-xs text-muted mt-1">{{ t('admin.billing.orgs.description') }}</p>
          </div>
          <UInput v-model="orgSearch" icon="i-lucide-search" :placeholder="t('admin.billing.filterOrg')" class="w-64 max-w-full" />
        </div>
      </template>
      <UTable
        :data="organizations"
        :columns="organizationColumns"
        :loading="organizationsStatus === 'pending' && !organizationsData"
        :empty="t('admin.billing.orgs.empty')"
        :ui="{ ...tableUi, tr: 'cursor-pointer hover:bg-elevated/50' }"
        @select="(_event: Event, row: { original: BillingOrganization }) => openOrganization(row.original)"
      >
        <template #organization-cell="{ row }">
          <UUser
            :name="row.original.organization_name"
            :avatar="{ alt: row.original.organization_name, size: 'xs' }"
            :ui="{ name: 'truncate max-w-64' }"
          />
        </template>
        <template #invoices-cell="{ row }">
          <span class="tabular-nums">{{ row.original.invoice_count }}</span>
          <UBadge
            v-if="row.original.overdue_count"
            color="error"
            variant="subtle"
            size="sm"
            class="ms-2"
            :label="t('admin.billing.orgs.overdueCount', { count: row.original.overdue_count })"
          />
        </template>
        <template #gross-cell="{ row }">
          <span class="tabular-nums">{{ formatCents(row.original.gross_revenue_cents, organizationCurrency) }}</span>
        </template>
        <template #outstanding-cell="{ row }">
          <span class="tabular-nums" :class="row.original.outstanding_cents ? 'text-warning' : 'text-muted'">
            {{ formatCents(row.original.outstanding_cents, organizationCurrency) }}
          </span>
        </template>
        <template #last-cell="{ row }">
          <span class="text-muted">{{ row.original.last_issued_at ? formatDay(row.original.last_issued_at) : '—' }}</span>
        </template>
        <template #open-cell>
          <UIcon name="i-lucide-chevron-right" class="size-4 text-muted" />
        </template>
      </UTable>
    </UCard>

    <template v-else>
    <div class="flex items-center gap-2">
      <UButton
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        size="sm"
        :label="t('admin.billing.orgs.back')"
        @click="backToOrganizations"
      />
      <h2 class="text-base font-semibold truncate">{{ selectedOrgName }}</h2>
    </div>
    <!-- Summary tiles -->
    <UCard v-if="summaryTiles.length" class="shrink-0" :ui="{ body: 'p-4 sm:p-5' }">
      <UPageGrid class="grid-cols-1 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <UCard
          v-for="tile in summaryTiles"
          :key="tile.label"
          variant="subtle"
          :ui="{ body: 'p-3 sm:p-4' }"
        >
          <UUser
            :name="tile.value"
            :description="tile.label"
            :avatar="{ icon: tile.icon, size: 'sm' }"
            :ui="{ name: 'text-lg sm:text-xl font-semibold tabular-nums truncate', description: 'text-xs' }"
          />
        </UCard>
      </UPageGrid>
    </UCard>

    <!-- Filters + table -->
    <UCard class="shrink-0" :ui="{ header: 'px-4 py-3 sm:px-5', body: 'p-0 sm:p-0' }">
      <template #header>
        <div class="flex flex-wrap items-end gap-3">
          <UFormField :label="t('admin.billing.number')" class="w-44">
            <UInput v-model="search.number" icon="i-lucide-hash" :placeholder="t('admin.billing.number')" class="w-full" />
          </UFormField>
          <UFormField :label="t('admin.billing.filterSource')" class="w-48">
            <USelect
              v-model="search.source"
              :items="sourceKinds.map(value => ({ label: t(`admin.billing.sourceFilter.${value}`), value }))"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="t('admin.billing.payment.column')" class="w-40">
            <USelect
              v-model="paymentFilter"
              :items="paymentFilters.map(value => ({ label: t(`admin.billing.payment.filter.${value}`), value }))"
              class="w-full"
            />
          </UFormField>
          <!-- Date range: goes to API -->
          <UFormField :label="t('admin.billing.filterFrom')" class="w-38">
            <UInput v-model="dateFilters.from" type="date" :max="dateFilters.to || today" class="w-full" />
          </UFormField>
          <UFormField :label="t('admin.billing.filterTo')" class="w-38">
            <UInput v-model="dateFilters.to" type="date" :min="dateFilters.from" :max="today" class="w-full" />
          </UFormField>
          <UButton
            v-if="hasFilters"
            icon="i-lucide-x"
            color="neutral"
            variant="outline"
            :label="t('admin.billing.clearFilters')"
            @click="clearFilters"
          />
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            :loading="status === 'pending'"
            :aria-label="t('admin.ai.refresh')"
            @click="refresh()"
          />
        </div>
      </template>

      <UTable
        :data="invoices"
        :columns="columns"
        :loading="status === 'pending' && !data"
        :empty="t('admin.billing.empty')"
        :ui="tableUi"
      >
        <template #number-cell="{ row }">
          <UBadge color="neutral" variant="soft" :label="row.original.number" />
        </template>
        <template #kind-cell="{ row }">
          <UBadge
            :color="row.original.kind === 'credit_note' ? 'warning' : 'primary'"
            variant="subtle"
            :label="row.original.kind === 'credit_note' ? t('admin.billing.kindCreditNote') : t('admin.billing.kindInvoice')"
          />
        </template>
        <template #source-cell="{ row }">
          <span class="text-muted">{{ sourceLabel[row.original.source_type] ?? row.original.source_type }}</span>
        </template>
        <template #issued_at-cell="{ row }">
          {{ formatDate(row.original.issued_at) }}
        </template>
        <template #payment-cell="{ row }">
          <div v-if="row.original.payment_status" class="flex flex-col items-start gap-0.5">
            <UBadge
              :color="paymentColor[row.original.payment_status]"
              variant="subtle"
              :label="t(`admin.billing.payment.status.${row.original.payment_status}`)"
            />
            <span v-if="row.original.payment_status === 'paid' && row.original.paid_at" class="text-xs text-muted">
              {{ formatDay(row.original.paid_at) }} · {{ t(`admin.billing.payment.method.${row.original.payment_method}`) }}
            </span>
            <span v-else-if="row.original.due_at && row.original.payment_status !== 'credited'" class="text-xs text-muted">
              {{ t('admin.billing.payment.dueOn', { date: formatDay(row.original.due_at) }) }}
            </span>
          </div>
          <span v-else class="text-muted">—</span>
        </template>
        <template #total-cell="{ row }">
          <span :class="row.original.kind === 'credit_note' ? 'text-warning' : ''">
            {{ formatCents(row.original.total_cents, row.original.currency) }}
          </span>
        </template>
        <template #actions-cell="{ row }">
          <UButton
            v-if="row.original.payment_status === 'unpaid' || row.original.payment_status === 'overdue'"
            icon="i-lucide-badge-check"
            color="success"
            variant="ghost"
            size="xs"
            :aria-label="`${t('admin.billing.payment.markPaid')} ${row.original.number}`"
            @click="openPayment(row.original)"
          />
          <UButton
            v-else-if="row.original.payment_status === 'paid'"
            icon="i-lucide-undo-2"
            color="neutral"
            variant="ghost"
            size="xs"
            :loading="savingPayment === row.original.id"
            :disabled="!!savingPayment && savingPayment !== row.original.id"
            :aria-label="`${t('admin.billing.payment.markUnpaid')} ${row.original.number}`"
            @click="markUnpaid(row.original)"
          />
          <UButton
            icon="i-lucide-eye"
            color="neutral"
            variant="ghost"
            size="xs"
            :aria-label="`${t('admin.billing.preview')} ${row.original.number}`"
            @click="preview = row.original"
          />
          <UButton
            :to="pdfUrl(row.original, false)"
            external
            download
            icon="i-lucide-download"
            color="neutral"
            variant="ghost"
            size="xs"
            :aria-label="`${t('admin.billing.download')} ${row.original.number}`"
          />
        </template>
      </UTable>
    </UCard>

    <!-- Same in-page preview as the organization details. -->
    <UModal
      :open="!!preview"
      :title="preview?.number"
      :description="preview?.organization_name"
      :ui="{ content: 'sm:max-w-4xl h-[90dvh]', body: 'p-0 sm:p-0 flex-1' }"
      @update:open="(value: boolean) => { if (!value) preview = null }"
    >
      <template #body>
        <iframe v-if="preview" :src="pdfUrl(preview, true)" :title="preview.number" class="h-full min-h-[70dvh] w-full border-0" />
      </template>
      <template #footer>
        <UButton
          v-if="preview"
          :to="pdfUrl(preview, false)"
          external
          download
          icon="i-lucide-download"
          color="neutral"
          variant="outline"
          label="PDF"
        />
      </template>
    </UModal>

    <UModal
      :open="!!paying"
      :title="t('admin.billing.payment.markPaid')"
      :description="paying ? `${paying.number} · ${paying.organization_name}` : ''"
      @update:open="(value: boolean) => { if (!value) paying = null }"
    >
      <template #body>
        <div class="flex flex-col gap-4">
          <UFormField :label="t('admin.billing.payment.paidAt')">
            <UInput v-model="paymentForm.paid_at" type="date" :max="today" class="w-full" />
          </UFormField>
          <UFormField :label="t('admin.billing.payment.methodLabel')">
            <USelect
              v-model="paymentForm.method"
              :items="paymentMethods.map(value => ({ label: t(`admin.billing.payment.method.${value}`), value }))"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="t('admin.billing.payment.note')">
            <UTextarea v-model="paymentForm.note" :rows="2" :maxlength="500" class="w-full" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="outline" :label="t('admin.billing.payment.cancel')" @click="paying = null" />
          <UButton
            color="success"
            icon="i-lucide-badge-check"
            :loading="!!paying && savingPayment === paying.id"
            :disabled="!paymentForm.paid_at"
            :label="t('admin.billing.payment.confirmPaid')"
            @click="markPaid"
          />
        </div>
      </template>
    </UModal>

    </template>

    <template v-if="selectedOrgId" #footer>
      <ListPagination
        v-model:page="page"
        v-model:page-size="pageSize"
        :total="data?.total || 0"
        :sibling-count="1"
        show-edges
      />
    </template>
  </AdminPage>
</template>
