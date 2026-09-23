<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

definePageMeta({ layout: 'admin', middleware: 'superadmin' })
const { t } = useI18n()
const { showError } = useFormFeedback()
useSeoMeta({ title: () => `${t('admin.nav.billing')} · Rrit Admin`, robots: 'noindex, nofollow' })

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
}

type BillingResponse = {
  invoices: Invoice[]
  summary: {
    total_revenue_cents: number
    total_credit_notes_cents: number
    gross_revenue_cents: number
    net_revenue_cents: number
    vat_cents: number
    this_month_cents: number
    this_month_net_cents: number
  }
  total: number
  page: number
}

const today = new Date().toISOString().slice(0, 10)
const page = ref(1)
const pageSize = ref(20)

// Date filters go to the API
const dateFilters = reactive({ from: '', to: '' })
// Text filters are client-side (fast, no extra round trip for short lists)
const search = reactive({ org: '', number: '' })

watch([() => dateFilters.from, () => dateFilters.to], () => { page.value = 1 })

const query = computed(() => ({
  page: page.value,
  per_page: pageSize.value,
  ...(dateFilters.from ? { from: dateFilters.from } : {}),
  ...(dateFilters.to ? { to: dateFilters.to } : {}),
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
  const org = search.org.trim().toLowerCase()
  const num = search.number.trim().toLowerCase()
  return list.filter(inv =>
    (!org || inv.organization_name?.toLowerCase().includes(org))
    && (!num || inv.number.toLowerCase().includes(num)),
  )
})

const euro = new Intl.NumberFormat('sq-XK', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })
const formatCents = (cents: number) => euro.format(cents / 100)
// Invoices show the purchase time, to the second.
const formatDate = (value: string) =>
  new Intl.DateTimeFormat('sq-XK', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Belgrade' }).format(new Date(value))

const summary = computed(() => data.value?.summary)
const summaryTiles = computed(() => {
  const s = summary.value
  if (!s) return []
  return [
    // All after credit notes: gross includes VAT, net excludes it.
    { label: t('admin.billing.grossRevenue'), value: formatCents(s.gross_revenue_cents), icon: 'i-lucide-receipt' },
    { label: t('admin.billing.netRevenue'), value: formatCents(s.net_revenue_cents), icon: 'i-lucide-trending-up' },
    { label: t('admin.billing.vat'), value: formatCents(s.vat_cents), icon: 'i-lucide-landmark' },
  ]
})

const hasFilters = computed(() => !!(dateFilters.from || dateFilters.to || search.org || search.number))
function clearFilters() {
  dateFilters.from = ''
  dateFilters.to = ''
  search.org = ''
  search.number = ''
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

const columns = computed<TableColumn<Invoice>[]>(() => [
  { accessorKey: 'number', header: t('admin.billing.number') },
  { id: 'organization', header: t('admin.billing.organization') },
  { id: 'kind', header: t('admin.billing.kind'), meta: wide },
  { id: 'source', header: t('admin.billing.filterSource'), meta: wide },
  { id: 'issued_at', header: t('admin.billing.issuedAt') },
  { id: 'total', header: t('admin.billing.total'), meta: endAligned },
  { id: 'actions', header: '', meta: endAligned },
])

const sourceLabel: Record<string, string> = {
  subscription_activation: t('admin.billing.sourceSubscriptionActivation'),
  subscription_upgrade: t('admin.billing.sourceSubscriptionUpgrade'),
  credit_top_up: t('admin.billing.sourceCreditTopUp'),
  credit_note: t('admin.billing.sourceCreditNote'),
}
</script>

<template>
  <AdminPage :title="t('admin.nav.billing')">
    <!-- Summary tiles -->
    <UCard v-if="summaryTiles.length" class="shrink-0" :ui="{ body: 'p-4 sm:p-5' }">
      <UPageGrid class="grid-cols-1 gap-3 sm:grid-cols-3">
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
          <!-- Text search: client-side -->
          <UFormField :label="t('admin.billing.filterOrg')" class="w-44">
            <UInput v-model="search.org" icon="i-lucide-building-2" :placeholder="t('admin.billing.filterOrg')" class="w-full" />
          </UFormField>
          <UFormField :label="t('admin.billing.number')" class="w-44">
            <UInput v-model="search.number" icon="i-lucide-hash" :placeholder="t('admin.billing.number')" class="w-full" />
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
        :loading="status === 'pending'"
        :empty="t('admin.billing.empty')"
        :ui="tableUi"
      >
        <template #number-cell="{ row }">
          <UBadge color="neutral" variant="soft" :label="row.original.number" />
        </template>
        <template #organization-cell="{ row }">
          <UUser
            :name="row.original.organization_name || row.original.organization_id"
            :avatar="{ alt: row.original.organization_name || '', size: 'xs' }"
            :ui="{ name: 'truncate max-w-52' }"
          />
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
        <template #total-cell="{ row }">
          <span :class="row.original.kind === 'credit_note' ? 'text-warning' : ''">
            {{ formatCents(row.original.total_cents) }}
          </span>
        </template>
        <template #actions-cell="{ row }">
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

    <template #footer>
      <ListPagination
        v-model:page="page"
        v-model:page-size="pageSize"
        :total="data?.total || 0"
        :sibling-count="1"
        show-edges
        compact-mobile
      />
    </template>
  </AdminPage>
</template>
