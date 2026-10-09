<script setup lang="ts">

definePageMeta({ layout: 'admin', middleware: 'superadmin' })
const { t } = useI18n()
const { showError } = useFormFeedback()
useSeoMeta({ title: () => `${t('admin.nav.overview')} · Rrit Admin`, robots: 'noindex, nofollow' })

type NewOrganization = { id: string; name: string; plan_name: string | null; created_at: string }
type Overview = {
  organizations: { active: number }
  subscriptions: { mrr_cents: number }
  revenue: { total_cents: number }
  sales: { plans_total_cents: number; plans_this_month_cents: number; credits_total_cents: number; credits_this_month_cents: number; videos_total_cents: number; videos_this_month_cents: number }
  ai: { cost_micro_eur_this_month: number; margin_cents_this_month: number }
  signups: { this_month: number }
  new_organizations: NewOrganization[]
}

const { data, status, error, refresh } = await useFetch<Overview>('/api/admin/overview', {
  lazy: true,
  key: 'admin-overview',
  getCachedData: () => undefined,
})
watch(error, (value) => {
  if (value) showError(t('admin.overview.loadError'))
}, { immediate: true })

// The provider balance, so a low balance is noticed here and not only on the
// AI costs page. Clicking the notice goes there.
const { data: balance, error: balanceError, refresh: refreshBalance } = await useFetch<{ balance_usd: number | null, level: 'ok' | 'warning' | 'critical', low_balance_usd: number, warn_balance_usd: number }>(
  '/api/admin/ai/balance',
  { lazy: true, getCachedData: () => undefined },
)
watch(balanceError, (value) => {
  if (value) showError(t('admin.overview.loadError'))
}, { immediate: true })
useHead({
  script: [{
    innerHTML: '',
    onload: () => {},
  }],
})
onMounted(() => {
  const route = useRoute()
  watch(() => route.fullPath, () => {
    refresh()
    refreshBalance()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refresh()
      refreshBalance()
    }
  })
})

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

const revenueSplit = computed(() => {
  const overview = data.value
  if (!overview) return { packageCents: 0, creditCents: 0, videoCents: 0, total: 0, packagePercent: 0, creditPercent: 0, videoPercent: 0 }
  const packageCents = overview.sales.plans_this_month_cents
  const creditCents = overview.sales.credits_this_month_cents
  const videoCents = overview.sales.videos_this_month_cents
  const total = Math.max(0, packageCents + creditCents + videoCents)
  return {
    packageCents,
    creditCents,
    videoCents,
    total,
    packagePercent: total ? Math.round((packageCents / total) * 100) : 0,
    creditPercent: total ? Math.round((creditCents / total) * 100) : 0,
    videoPercent: total ? Math.round((videoCents / total) * 100) : 0,
  }
})
const revenueChannels = computed(() => {
  const s = revenueSplit.value
  return [
    { label: t('admin.overview.salesPlans'), cents: s.packageCents, percent: s.packagePercent, hex: '#1e3a5f' },
    { label: t('admin.overview.salesCredits'), cents: s.creditCents, percent: s.creditPercent, hex: '#4a7c59' },
    { label: t('admin.overview.salesVideos'), cents: s.videoCents, percent: s.videoPercent, hex: '#b8860b' },
  ]
})

</script>

<template>
  <AdminPage :title="t('admin.nav.overview')">
    <div class="space-y-4 p-4 sm:space-y-5 sm:p-6 lg:p-8">
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

      <!-- Revenue breakdown -->
      <UCard :ui="{ body: 'p-5 sm:p-6' }">
        <div class="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p class="text-xs font-medium uppercase tracking-wider text-muted">{{ t('admin.overview.salesTitle') }}</p>
            <p class="mt-1 text-3xl font-bold tabular-nums tracking-tight">{{ euro.format(revenueSplit.total / 100) }}</p>
          </div>
          <!-- Stacked bar legend -->
          <div class="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
            <span v-for="item in revenueChannels" :key="item.label" class="flex items-center gap-1.5">
              <span class="size-2 rounded-full" :style="{ background: item.hex }" />
              {{ item.label }}
            </span>
          </div>
        </div>

        <!-- Stacked horizontal bar -->
        <div class="mt-5 flex h-3 overflow-hidden rounded-full bg-default/60">
          <UTooltip
            v-for="item in revenueChannels"
            :key="item.label"
            :style="{ width: `${item.percent}%` }"
          >
            <div
              class="h-3 w-full transition-all duration-200 hover:brightness-125"
              :style="{ background: item.hex }"
            />
            <template #content>
              <div class="flex items-center gap-2 px-1 py-0.5 text-xs">
                <span class="size-2 shrink-0 rounded-full" :style="{ background: item.hex }" />
                <span>{{ item.label }}</span>
                <span class="font-semibold tabular-nums">{{ euro.format(item.cents / 100) }}</span>
                <span class="tabular-nums text-muted">{{ item.percent }}%</span>
              </div>
            </template>
          </UTooltip>
        </div>

        <!-- Breakdown cards -->
        <div class="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div
            v-for="item in revenueChannels"
            :key="item.label"
            class="relative overflow-hidden rounded-xl border border-default/60 px-4 py-3"
          >
            <div class="absolute inset-y-0 left-0 w-1 rounded-l-xl" :style="{ background: item.hex }" />
            <p class="text-xs text-muted">{{ item.label }}</p>
            <p class="mt-0.5 text-lg font-semibold tabular-nums">{{ euro.format(item.cents / 100) }}</p>
            <p class="text-xs tabular-nums text-muted">{{ item.percent }}%</p>
          </div>
        </div>
      </UCard>

      <!-- New organizations -->
      <UCard :ui="{ body: 'p-5 sm:p-6' }">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-xs font-medium uppercase tracking-wider text-muted">{{ t('admin.overview.newOrganizations') }}</p>
            <p class="mt-1 text-2xl font-bold tabular-nums tracking-tight">{{ data?.new_organizations?.length ?? 0 }}</p>
          </div>
          <UAvatar icon="i-lucide-building-2" size="lg" :ui="{ root: 'bg-primary/10 text-primary' }" />
        </div>

        <div v-if="data?.new_organizations?.length" class="mt-5 divide-y divide-default/60">
          <div
            v-for="org in data.new_organizations"
            :key="org.id"
            class="flex cursor-pointer items-center gap-3 py-3 transition-colors first:pt-0 last:pb-0 hover:bg-elevated/40"
            @click="navigateTo(`/admin/organizations/${org.id}`)"
          >
            <UAvatar :alt="org.name" size="sm" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">{{ org.name }}</p>
              <p class="text-xs text-muted">{{ formatDate(org.created_at) }}</p>
            </div>
            <UBadge v-if="org.plan_name" color="neutral" variant="soft" size="xs" :label="org.plan_name" />
            <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-muted" />
          </div>
        </div>
        <div v-else class="mt-5 flex flex-col items-center gap-2 py-6 text-center">
          <UIcon name="i-lucide-inbox" class="size-8 text-muted/50" />
          <p class="text-sm text-muted">{{ t('admin.overview.noNewOrganizations') }}</p>
        </div>
      </UCard>

    </div>
  </AdminPage>
</template>
