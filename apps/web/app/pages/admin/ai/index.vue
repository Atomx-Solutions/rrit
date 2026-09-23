<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

definePageMeta({ layout: 'admin', middleware: 'superadmin' })
const { t } = useI18n()
const { showError } = useFormFeedback()
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
// Costs always cover the OpenRouter key configured in .env. The saved dates
// live in the URL, so they survive a reload.
const route = useRoute()
const router = useRouter()
const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
const range = reactive({
  from: isDate(route.query.from) ? route.query.from : monthStart,
  to: isDate(route.query.to) ? route.query.to : today,
})
// A changed date reloads the report at once and is kept in the URL.
watch(range, () => {
  router.replace({ query: { ...route.query, from: range.from, to: range.to } })
})
const { data, error } = await useFetch<Costs>('/api/admin/ai/costs', {
    // Open the page at once and show loading inside it, instead of blocking navigation.
    lazy: true,
  key: 'admin-ai-costs',
  query: computed(() => ({ from: range.from, to: range.to })),
})
watch(error, (value) => {
  if (value) showError(t('admin.ai.providerUnavailable'))
}, { immediate: true })

const euro = new Intl.NumberFormat('sq-XK', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const number = new Intl.NumberFormat('sq-XK')
const microEur = (value: number) => euro.format(value / 1_000_000)

function formatDay(value: string) {
  // Numeric: some browsers lack Albanian month names and print "M09".
  return new Intl.DateTimeFormat('sq-XK', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
}

const account = computed(() => data.value?.provider_account)
const usdMicroEur = computed(() => account.value?.usd_micro_eur ?? null)

function usdWithEur(value: number) {
  const rate = usdMicroEur.value
  if (!rate) return dollars.format(value)
  return `${dollars.format(value)} ≈ ${euro.format((value * rate) / 1_000_000)}`
}

// Provider top-up URL (opens in new tab, user never leaves the admin page)
// Where "Add credit" goes is a platform setting, because the provider has no
// card-payment API we could call from here.
const { data: platformSettings } = await useFetch<{ ai_top_up_url: string, ai_low_balance_usd: number, ai_warn_balance_usd: number }>('/api/admin/settings', { lazy: true })
const topUpUrl = computed(() => platformSettings.value?.ai_top_up_url || 'https://openrouter.ai/settings/credits')

const account_balance = computed(() => account.value?.account?.balance_usd ?? null)
// The threshold comes from the admin settings page.
const low_balance = computed(() =>
  account_balance.value !== null && account_balance.value < (platformSettings.value?.ai_warn_balance_usd ?? 30))

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
// The day shown under the chart: the one hovered or tapped, else the busiest.
const activeDate = ref<string | null>(null)
const activeDay = computed(() =>
  daily.value.find(day => day.date === activeDate.value)
  || daily.value.reduce<Costs['daily'][number] | null>((busiest, day) => (!busiest || day.calls > busiest.calls ? day : busiest), null))
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

      <div v-if="capacityTiles.length" class="space-y-3">
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
      <!-- Calls per day: hover (or focus) a bar for the date, calls and cost. -->
      <UCard class="shrink-0" :ui="{ header: 'px-4 py-3 sm:px-5', body: 'p-4 sm:p-5' }">
        <template #header>
          <UUser
            :name="t('admin.ai.dailyTitle')"
            :description="t('admin.ai.dailyDescription', { max: number.format(maxDailyCalls) })"
            :avatar="{ icon: 'i-lucide-chart-column', size: 'sm' }"
          />
        </template>
        <!-- Plain bars sized by height, with no tooltip wrapper: on touch screens the
             wrapper collapsed the bars to zero height after hydration. Hovering or
             tapping a bar shows that day below the chart. -->
        <UFieldGroup :aria-label="t('admin.ai.dailyTitle')" class="flex h-44 w-full items-end gap-1 sm:gap-1.5">
          <UButton
            v-for="day in daily"
            :key="day.date"
            color="neutral"
            variant="ghost"
            :aria-label="dayTooltip(day)"
            :aria-pressed="activeDay?.date === day.date"
            class="flex h-44 min-w-0 flex-1 items-end rounded-none p-0 hover:bg-elevated/60 focus-visible:ring-2"
            @mouseenter="activeDate = day.date"
            @focus="activeDate = day.date"
            @click="activeDate = day.date"
          >
            <UBadge
              as="span"
              :color="activeDay?.date === day.date ? 'primary' : 'neutral'"
              variant="solid"
              class="block w-full rounded-none rounded-t-sm p-0"
              :class="activeDay?.date === day.date ? '' : 'bg-primary/70'"
              :style="{ height: `${maxDailyCalls ? Math.max((day.calls / maxDailyCalls) * 100, day.calls ? 2 : 0) : 0}%` }"
            />
          </UButton>
        </UFieldGroup>
        <UAlert
          v-if="activeDay"
          color="neutral"
          variant="subtle"
          icon="i-lucide-calendar-days"
          class="mt-3"
          :title="dayTooltip(activeDay)"
        />
        <UFieldGroup v-if="daily.length" class="mt-2 flex w-full justify-between">
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
