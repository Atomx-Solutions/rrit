<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

definePageMeta({ layout: 'admin', middleware: 'superadmin' })
const { t } = useI18n()
useSeoMeta({ title: () => `${t('admin.nav.subscriptions')} · Rrit Admin`, robots: 'noindex, nofollow' })

type Subscription = {
  id: string
  organization_id: string
  organization_name: string
  plan_code: string
  plan_name: string
  billing_interval: 'monthly' | 'annual'
  status: string
  current_period_start: string
  current_period_end: string
  price_cents: number | null
  cancel_at_period_end: boolean
  paused_at: string | null
  paused_by: string | null
  days_until_expiry: number
}

const page = ref(1)
const pageSize = ref(20)
// Every filter is applied by the API, so pagination and totals stay correct.
const filters = reactive({ status: 'all', plan: 'all', expiring: 'all' })
watch([() => filters.status, () => filters.plan, () => filters.expiring, pageSize], () => {
  page.value = 1
})

const { plans } = usePlanCatalog()
const { data, status, error, refresh } = await useFetch<{ items: Subscription[]; total: number }>('/api/admin/subscriptions', {
    // Open the page at once and show loading inside it, instead of blocking navigation.
    lazy: true,
  key: 'admin-subscriptions',
  query: computed(() => ({
    page: page.value,
    per_page: pageSize.value,
    ...(filters.status !== 'all' ? { status: filters.status } : {}),
    ...(filters.plan !== 'all' ? { plan: filters.plan } : {}),
    ...(filters.expiring !== 'all' ? { expiring_days: filters.expiring } : {}),
  })),
})
const subscriptions = computed(() => data.value?.items || [])
// A new page starts at the top of the list, not where the previous one was scrolled.
const listCard = useTemplateRef<{ $el: HTMLElement }>('listCard')
watch(page, () => {
  listCard.value?.$el.scrollIntoView({ block: 'start', behavior: 'smooth' })
})

const statusOptions = computed(() => [
  { label: t('admin.subscriptions.statusAll'), value: 'all' },
  ...['trialing', 'active', 'paused', 'cancelled', 'expired'].map(value => ({ label: t(`admin.status.${value}`), value })),
])
const planOptions = computed(() => [
  { label: t('admin.organizations.allPlans'), value: 'all' },
  ...plans.value.map(plan => ({ label: plan.name, value: plan.code })),
])
const expiringOptions = computed(() => [
  { label: t('admin.subscriptions.expiringAll'), value: 'all' },
  { label: t('admin.subscriptions.expiring7'), value: '7' },
  { label: t('admin.subscriptions.expiring14'), value: '14' },
  { label: t('admin.subscriptions.expiring30'), value: '30' },
])
const hasFilters = computed(() => filters.status !== 'all' || filters.plan !== 'all' || filters.expiring !== 'all')
function clearFilters() {
  Object.assign(filters, { status: 'all', plan: 'all', expiring: 'all' })
}

const euro = new Intl.NumberFormat('sq-XK', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const formatCents = (value: number | null) => (value == null ? '—' : euro.format(value / 100))
const formatDate = (value: string) =>
  new Intl.DateTimeFormat('sq-XK', { dateStyle: 'medium', timeZone: 'Europe/Belgrade' }).format(new Date(value))
const intervalLabel = (value: string) =>
  value === 'annual' ? t('admin.subscriptions.intervalAnnual') : t('admin.subscriptions.intervalMonthly')

const statusColors: Record<string, 'success' | 'info' | 'warning' | 'error' | 'neutral'> = {
  active: 'success',
  trialing: 'info',
  paused: 'warning',
  past_due: 'error',
  cancelled: 'neutral',
  expired: 'neutral',
}
// Days left: red within a week, amber within two, only for subscriptions still running.
function daysColor(subscription: Subscription) {
  if (!['active', 'trialing', 'past_due'].includes(subscription.status)) return 'neutral' as const
  if (subscription.days_until_expiry <= 7) return 'error' as const
  if (subscription.days_until_expiry <= 14) return 'warning' as const
  return 'neutral' as const
}
const daysLabel = (subscription: Subscription) => t('admin.subscriptions.daysValue', { days: subscription.days_until_expiry })

const wide = { class: { th: 'hidden lg:table-cell', td: 'hidden lg:table-cell' } }
const endAligned = { class: { td: 'text-end', th: 'text-end' } }
const columns = computed<TableColumn<Subscription>[]>(() => [
  { id: 'organization', header: t('admin.subscriptions.organization') },
  { id: 'plan', header: t('admin.subscriptions.plan') },
  { id: 'status', header: t('admin.subscriptions.status') },
  { id: 'period_end', header: t('admin.subscriptions.periodEnd'), meta: wide },
  { id: 'days', header: t('admin.subscriptions.daysLeft') },
  { id: 'price', header: t('admin.subscriptions.price'), meta: endAligned },
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
</script>

<template>
  <AdminPage :title="t('admin.nav.subscriptions')">
    <!-- shrink-0: in the flex panel body the card would otherwise shrink and clip rows instead of scrolling. -->
    <UCard ref="listCard" class="shrink-0 scroll-mt-4" :ui="{ header: 'px-3 py-3 sm:px-4', body: 'p-0 sm:p-0' }">
      <template #header>
        <UForm :state="filters" class="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-[repeat(3,minmax(0,12rem))_auto]">
          <USelect v-model="filters.status" :items="statusOptions" :aria-label="t('admin.subscriptions.status')" class="w-full" />
          <USelect v-model="filters.plan" :items="planOptions" :aria-label="t('admin.subscriptions.plan')" class="w-full" />
          <USelect
            v-model="filters.expiring"
            :items="expiringOptions"
            icon="i-lucide-alarm-clock"
            :aria-label="t('admin.subscriptions.filterExpiring')"
            class="w-full"
          />
          <UButton
            v-if="hasFilters"
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            class="justify-self-start"
            :label="t('admin.subscriptions.clearFilters')"
            @click="clearFilters"
          />
        </UForm>
      </template>

      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        class="m-4"
        :title="t('admin.subscriptions.loadError')"
        :actions="[{ label: t('common.retry'), variant: 'outline', onClick: () => refresh() }]"
      />
      <template v-else>
        <!-- Phones: one card per subscription. -->
        <UCard
          v-for="subscription in subscriptions"
          :key="subscription.id"
          class="md:hidden"
          :ui="{ root: 'rounded-none ring-0 border-b border-default', body: 'p-4 sm:p-4 space-y-3' }"
        >
          <UUser
            :name="subscription.organization_name || subscription.organization_id"
            :description="`${subscription.plan_name} · ${intervalLabel(subscription.billing_interval)} · ${formatCents(subscription.price_cents)}`"
            :avatar="{ alt: subscription.organization_name || '', size: 'sm' }"
            :ui="{ root: 'w-full', wrapper: 'min-w-0 flex-1', name: 'truncate', description: 'truncate' }"
          />
          <UFieldGroup class="flex flex-wrap items-center gap-1.5">
            <UBadge :color="statusColors[subscription.status] || 'neutral'" variant="subtle" :label="t(`admin.status.${subscription.status}`)" />
            <UBadge v-if="subscription.cancel_at_period_end" color="warning" variant="outline" :label="t('admin.subscriptions.cancelAtEnd')" />
            <UBadge color="neutral" variant="soft" icon="i-lucide-calendar" :label="formatDate(subscription.current_period_end)" />
            <UBadge :color="daysColor(subscription)" variant="soft" icon="i-lucide-hourglass" :label="daysLabel(subscription)" />
          </UFieldGroup>
        </UCard>
        <UEmpty
          v-if="!subscriptions.length && status !== 'pending'"
          class="md:hidden py-10"
          icon="i-lucide-repeat"
          :title="t('admin.subscriptions.empty')"
        />

        <!-- Tablets and desktops: table; the period end column from lg. -->
        <UTable
          class="hidden md:block"
          :data="subscriptions"
          :columns="columns"
          :loading="status === 'pending'"
          :empty="t('admin.subscriptions.empty')"
          :ui="tableUi"
        >
          <template #organization-cell="{ row }">
            <UUser
              :name="row.original.organization_name || row.original.organization_id"
              :avatar="{ alt: row.original.organization_name || '', size: 'xs' }"
              :ui="{ name: 'truncate max-w-52' }"
            />
          </template>
          <template #plan-cell="{ row }">
            <UUser
              :name="row.original.plan_name"
              :description="`${row.original.plan_code} · ${intervalLabel(row.original.billing_interval)}`"
              :ui="{ name: 'font-medium' }"
            />
          </template>
          <template #status-cell="{ row }">
            <UBadge
              :color="statusColors[row.original.status] || 'neutral'"
              variant="subtle"
              :label="t(`admin.status.${row.original.status}`)"
            />
            <UBadge
              v-if="row.original.cancel_at_period_end"
              color="warning"
              variant="outline"
              size="sm"
              class="ms-1"
              :label="t('admin.subscriptions.cancelAtEnd')"
            />
          </template>
          <template #period_end-cell="{ row }">{{ formatDate(row.original.current_period_end) }}</template>
          <template #days-cell="{ row }">
            <UBadge :color="daysColor(row.original)" variant="soft" class="tabular-nums" :label="daysLabel(row.original)" />
          </template>
          <template #price-cell="{ row }">{{ formatCents(row.original.price_cents) }}</template>
        </UTable>
      </template>
    </UCard>

    <!-- Pinned to the bottom of the panel so page numbers are always visible. -->
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
