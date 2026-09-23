<script setup lang="ts">
import type { TableColumn, TableRow } from '@nuxt/ui'

definePageMeta({ layout: 'admin', middleware: 'superadmin' })
const { t } = useI18n()
const { showError } = useFormFeedback()
useSeoMeta({ title: () => `${t('admin.nav.overview')} · Rrit Admin`, robots: 'noindex, nofollow' })

type NewOrganization = { id: string; name: string; plan_name: string | null; created_at: string }
type Overview = {
  organizations: { active: number }
  subscriptions: { mrr_cents: number }
  revenue: { total_cents: number }
  sales: { plans_total_cents: number; plans_this_month_cents: number; credits_total_cents: number; credits_this_month_cents: number }
  ai: { cost_micro_eur_this_month: number; margin_cents_this_month: number }
  signups: { this_month: number }
  new_organizations: NewOrganization[]
}

const { data, status, error } = await useFetch<Overview>('/api/admin/overview', {
  // Open the page at once and show skeletons inside it, instead of blocking navigation.
  lazy: true,
  key: 'admin-overview',
})
watch(error, (value) => {
  if (value) showError(t('admin.overview.loadError'))
}, { immediate: true })

// The provider balance, so a low balance is noticed here and not only on the
// AI costs page. Clicking the notice goes there.
const { data: balance, error: balanceError } = await useFetch<{ balance_usd: number | null, level: 'ok' | 'warning' | 'critical', low_balance_usd: number, warn_balance_usd: number }>(
  '/api/admin/ai/balance',
  { lazy: true },
)
watch(balanceError, (value) => {
  if (value) showError(t('admin.overview.loadError'))
}, { immediate: true })
const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

const euro = new Intl.NumberFormat('sq-XK', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const count = new Intl.NumberFormat('sq-XK')
const formatDate = (value: string) =>
  new Intl.DateTimeFormat('sq-XK', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Belgrade' }).format(new Date(value))

const tiles = computed(() => {
  const overview = data.value
  if (!overview) return []
  const margin = overview.ai.margin_cents_this_month
  return [
    { label: t('admin.overview.activeOrganizations'), hint: t('admin.overview.activeOrganizationsHint'), value: count.format(overview.organizations.active), icon: 'i-lucide-building-2' },
    { label: t('admin.overview.mrr'), hint: t('admin.overview.mrrHint'), value: euro.format(overview.subscriptions.mrr_cents / 100), icon: 'i-lucide-repeat' },
    { label: t('admin.overview.totalRevenue'), hint: t('admin.overview.totalRevenueHint'), value: euro.format(overview.revenue.total_cents / 100), icon: 'i-lucide-receipt' },
    // Ledger costs are in micro-euros: 1 € = 1 000 000.
    { label: t('admin.overview.aiCost'), hint: t('admin.overview.aiCostHint'), value: euro.format(overview.ai.cost_micro_eur_this_month / 1_000_000), icon: 'i-lucide-cpu' },
    { label: t('admin.overview.aiMargin'), hint: t('admin.overview.aiMarginHint'), value: euro.format(margin / 100), icon: margin < 0 ? 'i-lucide-trending-down' : 'i-lucide-trending-up' },
    { label: t('admin.overview.signups'), hint: t('admin.overview.signupsHint'), value: count.format(overview.signups.this_month), icon: 'i-lucide-user-plus' },
  ]
})

// This month's sales, plans vs credit top-ups, as bars on one scale.
const moneyBars = computed(() => {
  const overview = data.value
  if (!overview) return []
  const bars = [
    { label: t('admin.overview.salesPlans'), icon: 'i-lucide-package', cents: overview.sales.plans_this_month_cents, color: 'primary' as const },
    { label: t('admin.overview.salesCredits'), icon: 'i-lucide-coins', cents: overview.sales.credits_this_month_cents, color: 'info' as const },
  ]
  const largest = Math.max(1, ...bars.map(bar => bar.cents))
  return bars.map(bar => ({ ...bar, value: euro.format(bar.cents / 100), percent: Math.round((Math.max(0, bar.cents) / largest) * 100) }))
})

const columns = computed<TableColumn<NewOrganization>[]>(() => [
  { accessorKey: 'name', header: t('admin.overview.name') },
  { id: 'plan', header: t('admin.overview.plan') },
  { id: 'created_at', header: t('admin.overview.date'), meta: { class: { td: 'text-end', th: 'text-end' } } },
])
const tableUi = {
  root: 'w-full',
  base: 'w-full border-separate border-spacing-0',
  thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
  th: 'py-2.5 px-4 text-xs font-medium',
  td: 'px-4 py-2.5 border-b border-default text-sm',
  tbody: '[&>tr]:last:[&>td]:border-b-0 [&>tr]:cursor-pointer',
  separator: 'h-0',
}

// A row opens that organization's details, as on the organizations page.
function onSelect(_event: Event, row: TableRow<NewOrganization>) {
  navigateTo(`/admin/organizations/${row.original.id}`)
}
</script>

<template>
  <AdminPage :title="t('admin.nav.overview')">
    <!-- Red below the critical amount, amber while getting close. -->
      <UAlert
        v-if="balance && balance.level !== 'ok'"
        :color="balance.level === 'critical' ? 'error' : 'warning'"
        variant="subtle"
        :icon="balance.level === 'critical' ? 'i-lucide-battery-warning' : 'i-lucide-battery-low'"
        class="shrink-0"
        :title="t(balance.level === 'critical' ? 'admin.overview.lowBalance' : 'admin.overview.nearBalance', { balance: dollars.format(balance.balance_usd ?? 0) })"
        :description="t(balance.level === 'critical' ? 'admin.overview.lowBalanceHint' : 'admin.overview.nearBalanceHint', { threshold: dollars.format(balance.level === 'critical' ? balance.low_balance_usd : balance.warn_balance_usd) })"
        :actions="[{ label: t('admin.overview.openAiCosts'), color: balance.level === 'critical' ? 'error' : 'warning', variant: 'solid', to: '/admin/ai' }]"
      />
      <!-- Two tiles per row on phones, three on tablets, all six in a row on wide screens. -->
      <UPageGrid class="shrink-0 grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
        <template v-if="status === 'pending' && !data">
          <UCard v-for="index in 6" :key="index" variant="subtle" :ui="{ body: 'p-3 sm:p-4 space-y-2' }">
            <USkeleton class="size-8 rounded-full" />
            <USkeleton class="h-6 w-24" />
            <USkeleton class="h-3 w-32 max-w-full" />
          </UCard>
        </template>
        <UCard v-for="tile in tiles" v-else :key="tile.label" variant="subtle" :ui="{ body: 'p-3 sm:p-4 space-y-2' }">
          <UFieldGroup class="flex w-full items-center justify-between">
            <UAvatar :icon="tile.icon" size="sm" />
            <!-- The explanation opens on click or tap, so it works on touch screens too. -->
            <UPopover :content="{ side: 'top', collisionPadding: 12 }">
              <UButton icon="i-lucide-info" color="neutral" variant="ghost" size="xs" :aria-label="tile.label" />
              <template #content>
                <UCard variant="outline" :ui="{ root: 'max-w-64 ring-0', body: 'p-3 sm:p-3 text-xs text-muted' }">
                  {{ tile.hint }}
                </UCard>
              </template>
            </UPopover>
          </UFieldGroup>
          <UUser
            :name="tile.value"
            :description="tile.label"
            :ui="{ name: 'text-lg sm:text-xl font-semibold tabular-nums truncate', description: 'text-xs truncate' }"
          />
        </UCard>
      </UPageGrid>

      <!-- Sales and new organizations side by side on wide screens, stacked on smaller ones. -->
      <UPageGrid class="shrink-0 grid-cols-1 gap-3 lg:grid-cols-2">
      <UCard v-if="moneyBars.length" :ui="{ header: 'px-4 py-3 sm:px-5', body: 'p-4 sm:p-5 space-y-4' }">
        <template #header>
          <UUser :name="t('admin.overview.salesTitle')" />
        </template>
        <UFieldGroup v-for="bar in moneyBars" :key="bar.label" orientation="vertical" class="w-full gap-1.5">
          <UFieldGroup class="flex w-full items-center justify-between gap-3">
            <UUser :name="bar.label" :avatar="{ icon: bar.icon, size: 'xs' }" :ui="{ name: 'text-sm truncate' }" />
            <UBadge color="neutral" variant="soft" class="tabular-nums" :label="bar.value" />
          </UFieldGroup>
          <UProgress :model-value="bar.percent" :color="bar.color" size="md" :aria-label="`${bar.label}: ${bar.value}`" />
        </UFieldGroup>
      </UCard>

      <UCard :ui="{ header: 'px-4 py-3 sm:px-5', body: 'p-0 sm:p-0' }">
        <template #header>
          <UUser :name="t('admin.overview.newOrganizations')" />
        </template>
        <UTable
          :data="data?.new_organizations || []"
          :columns="columns"
          :loading="status === 'pending' && !data"
          :empty="t('admin.overview.noNewOrganizations')"
          :ui="tableUi"
          @select="onSelect"
        >
          <template #name-cell="{ row }">
            <UUser
              :name="row.original.name"
              :avatar="{ alt: row.original.name, size: 'xs' }"
              :ui="{ name: 'truncate max-w-40 sm:max-w-64' }"
            />
          </template>
          <template #plan-cell="{ row }">
            <UBadge color="neutral" variant="soft" :label="row.original.plan_name || '—'" />
          </template>
          <template #created_at-cell="{ row }">
            {{ formatDate(row.original.created_at) }}
          </template>
        </UTable>
      </UCard>
      </UPageGrid>

  </AdminPage>
</template>
