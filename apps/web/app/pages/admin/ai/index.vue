<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

definePageMeta({ layout: 'admin', middleware: 'superadmin' })
const { t } = useI18n()
useSeoMeta({ title: () => `${t('admin.nav.ai')} · Rrit Admin`, robots: 'noindex, nofollow' })

type Costs = {
  summary: { total_cost_micro_eur: number; this_month_cost_micro_eur: number; total_calls: number }
  by_model: Array<{ model: string; calls: number; cost_micro_eur: number; input_tokens: number; output_tokens: number }>
  by_organization: Array<{ organization_id: string; organization_name: string | null; calls: number; cost_micro_eur: number; credits_consumed: number }>
  daily: Array<{ date: string; calls: number; cost_micro_eur: number }>
  provider_account: {
    provider: 'openrouter'
    key: { usage_usd: number; usage_daily_usd: number; limit_usd: number | null; limit_remaining_usd: number | null } | null
    account: { total_credits_usd: number; total_usage_usd: number; balance_usd: number } | null
    usd_micro_eur: number | null
    error: string | null
  } | null
}

const today = new Date().toISOString().slice(0, 10)
const monthStart = `${today.slice(0, 8)}01`
const range = reactive({ from: monthStart, to: today, scope: 'current' as 'current' | 'all' })
const scopeOptions = computed(() => [
  { label: t('admin.ai.scopeCurrentKey'), value: 'current' },
  { label: t('admin.ai.scopeAllStored'), value: 'all' },
])
const { data, status, error, refresh } = await useFetch<Costs>('/api/admin/ai/costs', {
  key: 'admin-ai-costs',
  query: computed(() => ({ from: range.from, to: range.to, scope: range.scope })),
})

const euro = new Intl.NumberFormat('sq-XK', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const number = new Intl.NumberFormat('sq-XK')
const microEur = (value: number) => euro.format(value / 1_000_000)

function formatDay(value: string) {
  return new Intl.DateTimeFormat('sq-XK', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
}

const account = computed(() => data.value?.provider_account)
const usdMicroEur = computed(() => account.value?.usd_micro_eur ?? null)

function usdWithEur(value: number) {
  const rate = usdMicroEur.value
  if (!rate) return dollars.format(value)
  return `${dollars.format(value)} ≈ ${euro.format((value * rate) / 1_000_000)}`
}

// Provider top-up URL (opens in new tab, user never leaves the admin page)
const topUpUrl = 'https://openrouter.ai/workspaces/default'

const account_balance = computed(() => account.value?.account?.balance_usd ?? null)
const low_balance = computed(() => account_balance.value !== null && account_balance.value < 5)

// Capacity tiles: only what matters for platform health
const capacityTiles = computed(() => {
  const a = account.value
  if (!a || a.error || (!a.key && !a.account)) return []
  const tiles = []
  if (a.account) {
    tiles.push({
      label: t('admin.ai.accountBalance'),
      value: usdWithEur(a.account.balance_usd),
      icon: 'i-lucide-wallet',
      warn: low_balance.value,
    })
    tiles.push({
      label: t('admin.ai.accountDeposited'),
      value: usdWithEur(a.account.total_credits_usd),
      icon: 'i-lucide-piggy-bank',
      warn: false,
    })
    tiles.push({
      label: t('admin.ai.accountUsedTotal'),
      value: usdWithEur(a.account.total_usage_usd),
      icon: 'i-lucide-trending-up',
      warn: false,
    })
  }
  if (a.key) {
    tiles.push({
      label: t('admin.ai.currentKeyUsageTotal'),
      value: usdWithEur(a.key.usage_usd),
      icon: 'i-lucide-key-round',
      warn: false,
    })
    tiles.push({
      label: t('admin.ai.keyToday'),
      value: usdWithEur(a.key.usage_daily_usd),
      icon: 'i-lucide-sun',
      warn: false,
    })
  }
  return tiles
})

// Usage tiles from our own ledger
const usageTiles = computed(() => {
  const summary = data.value?.summary
  if (!summary) return []
  return [
    { label: t('admin.ai.thisMonth'), value: microEur(summary.this_month_cost_micro_eur), icon: 'i-lucide-calendar', warn: false },
    { label: t('admin.ai.realCostPeriod'), value: microEur(summary.total_cost_micro_eur), icon: 'i-lucide-receipt', warn: false },
    { label: t('admin.ai.calls'), value: number.format(summary.total_calls), icon: 'i-lucide-activity', warn: false },
  ]
})

const daily = computed(() => data.value?.daily || [])
const maxDailyCalls = computed(() => Math.max(0, ...daily.value.map(d => d.calls)))
const showDailyTable = ref(false)
function dayTooltip(day: Costs['daily'][number]) {
  return `${formatDay(day.date)}: ${number.format(day.calls)} ${t('admin.ai.callsShort')} · ${microEur(day.cost_micro_eur)}`
}

const hideOnPhone = { class: { th: 'hidden md:table-cell', td: 'hidden md:table-cell' } }
const endAligned = { class: { td: 'text-end', th: 'text-end' } }
const costColumn = [{ id: 'cost', header: t('admin.ai.realCost'), meta: endAligned }]
const modelColumns = computed<TableColumn<Costs['by_model'][number]>[]>(() => [
  { accessorKey: 'model', header: t('admin.ai.model') },
  { id: 'calls', header: t('admin.ai.calls') },
  { id: 'tokens', header: t('admin.ai.tokens'), meta: hideOnPhone },
  ...costColumn,
])
const organizationColumns = computed<TableColumn<Costs['by_organization'][number]>[]>(() => [
  { accessorKey: 'organization_name', header: t('admin.organizations.organization') },
  { id: 'calls', header: t('admin.ai.calls'), meta: hideOnPhone },
  ...costColumn,
])
const dailyColumns = computed<TableColumn<Costs['daily'][number]>[]>(() => [
  { accessorKey: 'date', header: t('admin.ai.date') },
  { id: 'calls', header: t('admin.ai.calls'), meta: endAligned },
])
const tableUi = {
  root: 'w-full',
  base: 'w-full border-separate border-spacing-0',
  thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
  th: 'py-2.5 px-4 text-xs font-medium',
  td: 'px-4 py-2.5 border-b border-default text-sm',
  tbody: '[&>tr]:last:[&>td]:border-b-0',
  separator: 'h-0',
}
const cardUi = { header: 'px-4 py-3 sm:px-5', body: 'p-0 sm:p-0' }
const tileUi = { name: 'text-lg sm:text-xl font-semibold tabular-nums truncate', description: 'text-xs' }
</script>

<template>
  <AdminPage :title="t('admin.nav.ai')">

    <!-- Kapaciteti i platformës + buton "Shto kredi" -->
    <UCard class="shrink-0" :ui="{ header: 'px-4 py-3 sm:px-5', body: 'p-4 sm:p-5 space-y-3' }">
      <template #header>
        <div class="flex items-center justify-between gap-3">
          <UUser
            :name="t('admin.ai.providerTitle')"
            :description="t('admin.ai.providerDescription')"
            :avatar="{ icon: 'i-lucide-server', size: 'sm' }"
          />
          <UButton
            icon="i-lucide-plus"
            color="primary"
            variant="solid"
            size="sm"
            :label="t('admin.ai.topUp')"
            :to="topUpUrl"
            target="_blank"
            rel="noopener noreferrer"
          />
        </div>
      </template>

      <UAlert
        v-if="error || !account || account.error"
        color="neutral"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="t('admin.ai.providerUnavailable')"
        :actions="[{ label: t('common.retry'), variant: 'outline', onClick: () => refresh() }]"
      />
      <div v-else-if="capacityTiles.length" class="space-y-3">
        <UAlert
          color="neutral"
          variant="subtle"
          icon="i-lucide-info"
          :title="t('admin.ai.providerCacheNote')"
        />
        <UPageGrid class="grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <UCard v-for="tile in capacityTiles" :key="tile.label" variant="subtle" :ui="{ body: 'p-3 sm:p-4' }">
            <UUser
              :name="tile.value"
              :description="tile.label"
              :avatar="{ icon: tile.icon, size: 'sm' }"
              :ui="{ ...tileUi, name: `${tileUi.name}${tile.warn ? ' text-error' : ''}` }"
            />
          </UCard>
        </UPageGrid>
      </div>
    </UCard>

    <!-- Shpenzimi nga ledger-i ynë -->
    <UCard class="shrink-0" :ui="{ header: 'px-4 py-3 sm:px-5', body: 'p-4 sm:p-5 space-y-4' }">
      <template #header>
        <UUser
          :name="t('admin.ai.usageTitle')"
          :description="t('admin.ai.usageDescription')"
          :avatar="{ icon: 'i-lucide-activity', size: 'sm' }"
        />
      </template>
      <UForm :state="range" class="flex flex-wrap items-end gap-3">
        <UFormField name="from" :label="t('admin.ai.from')">
          <UInput v-model="range.from" type="date" :max="range.to" class="w-full" />
        </UFormField>
        <UFormField name="to" :label="t('admin.ai.to')">
          <UInput v-model="range.to" type="date" :min="range.from" :max="today" class="w-full" />
        </UFormField>
        <UFormField name="scope" :label="t('admin.ai.scope')">
          <USelect v-model="range.scope" :items="scopeOptions" class="w-52" />
        </UFormField>
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          :loading="status === 'pending'"
          :label="t('admin.ai.refresh')"
          @click="refresh()"
        />
      </UForm>
      <UPageGrid v-if="data" class="grid-cols-2 gap-3">
        <UCard v-for="tile in usageTiles" :key="tile.label" variant="subtle" :ui="{ body: 'p-3 sm:p-4' }">
          <UUser
            :name="tile.value"
            :description="tile.label"
            :avatar="{ icon: tile.icon, size: 'sm' }"
            :ui="tileUi"
          />
        </UCard>
      </UPageGrid>
    </UCard>

    <template v-if="data">
      <!-- Grafiku ditor -->
      <UCard class="shrink-0" :ui="{ header: 'px-4 py-3 sm:px-5', body: 'p-4 sm:p-5' }">
        <template #header>
          <UFieldGroup class="flex w-full items-center justify-between gap-2">
            <UUser
              :name="t('admin.ai.dailyTitle')"
              :description="t('admin.ai.dailyDescription', { max: number.format(maxDailyCalls) })"
              :avatar="{ icon: 'i-lucide-chart-column', size: 'sm' }"
            />
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              :icon="showDailyTable ? 'i-lucide-chart-column' : 'i-lucide-table'"
              :label="showDailyTable ? t('admin.ai.showChart') : t('admin.ai.showTable')"
              @click="showDailyTable = !showDailyTable"
            />
          </UFieldGroup>
        </template>
        <UTable v-if="showDailyTable" :data="daily" :columns="dailyColumns" :ui="tableUi">
          <template #date-cell="{ row }">{{ formatDay(row.original.date) }}</template>
          <template #calls-cell="{ row }">{{ number.format(row.original.calls) }}</template>
        </UTable>
        <UFieldGroup v-else :aria-label="t('admin.ai.dailyTitle')" class="flex h-44 w-full items-end gap-px sm:gap-0.5">
          <UTooltip
            v-for="day in daily"
            :key="day.date"
            :text="dayTooltip(day)"
            :content="{ side: 'top' }"
            :delay-duration="0"
          >
            <UButton
              color="neutral"
              variant="ghost"
              :aria-label="dayTooltip(day)"
              class="h-full min-w-1 flex-1 rounded-none p-0 hover:bg-transparent focus-visible:ring-2"
            >
              <UProgress
                :model-value="maxDailyCalls ? (day.calls / maxDailyCalls) * 100 : 0"
                orientation="vertical"
                inverted
                color="primary"
                class="pointer-events-none h-full w-full"
                :ui="{ root: 'h-full w-full', base: 'h-full w-full rounded-t-sm rounded-b-none bg-elevated/40', indicator: 'rounded-t-sm rounded-b-none' }"
              />
            </UButton>
          </UTooltip>
        </UFieldGroup>
        <UFieldGroup v-if="!showDailyTable && daily.length" class="mt-2 flex w-full justify-between">
          <UBadge color="neutral" variant="soft" size="sm" :label="formatDay(daily[0]!.date)" />
          <UBadge color="neutral" variant="soft" size="sm" :label="formatDay(daily[daily.length - 1]!.date)" />
        </UFieldGroup>
      </UCard>

      <UPageGrid class="shrink-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <!-- By model -->
        <UCard :ui="cardUi">
          <template #header>
            <UUser :name="t('admin.ai.byModel')" :avatar="{ icon: 'i-lucide-cpu', size: 'sm' }" />
          </template>
          <UTable :data="data.by_model" :columns="modelColumns" :empty="t('admin.ai.empty')" :ui="tableUi">
            <template #model-cell="{ row }">
              <UBadge color="neutral" variant="soft" class="max-w-56 truncate" :label="row.original.model" />
            </template>
            <template #calls-cell="{ row }">{{ number.format(row.original.calls) }}</template>
            <template #tokens-cell="{ row }">
              {{ number.format(row.original.input_tokens) }} / {{ number.format(row.original.output_tokens) }}
            </template>
            <template #cost-cell="{ row }">{{ microEur(row.original.cost_micro_eur) }}</template>
          </UTable>
        </UCard>

        <!-- By organization -->
        <UCard :ui="cardUi">
          <template #header>
            <UUser :name="t('admin.ai.byOrganization')" :avatar="{ icon: 'i-lucide-building-2', size: 'sm' }" />
          </template>
          <UTable :data="data.by_organization" :columns="organizationColumns" :empty="t('admin.ai.empty')" :ui="tableUi">
            <template #organization_name-cell="{ row }">
              <UUser
                :name="row.original.organization_name || row.original.organization_id"
                :avatar="{ alt: row.original.organization_name || '', size: 'xs' }"
                :ui="{ name: 'truncate max-w-56' }"
              />
            </template>
            <template #calls-cell="{ row }">{{ number.format(row.original.calls) }}</template>
            <template #cost-cell="{ row }">{{ microEur(row.original.cost_micro_eur) }}</template>
          </UTable>
        </UCard>
      </UPageGrid>
    </template>
  </AdminPage>
</template>
