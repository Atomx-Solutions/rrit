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
const filters = reactive({ status: 'all', plan: 'all', expiringSoon: false })
watch([() => filters.status, () => filters.plan, () => filters.expiringSoon, pageSize], () => {
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
    ...(filters.expiringSoon ? { expiring_days: 7 } : {}),
  })),
})
const subscriptions = computed(() => data.value?.items || [])
// A new page starts at the top of the list, not where the previous one was scrolled.
const listCard = useTemplateRef<{ $el: HTMLElement }>('listCard')
watch(page, () => {
  listCard.value?.$el.scrollIntoView({ block: 'start', behavior: 'smooth' })
})

const statusTabs = computed(() => [
  { label: t('admin.subscriptions.tabAll'), value: 'all' },
  ...['active', 'trialing', 'paused', 'past_due', 'cancelled', 'expired'].map(value => ({ label: t(`admin.status.${value}`), value })),
])
const planOptions = computed(() => [
  { label: t('admin.organizations.allPlans'), value: 'all' },
  ...plans.value.map(plan => ({ label: plan.name, value: plan.code })),
])

const euro = new Intl.NumberFormat('sq-XK', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const formatCents = (value: number | null) => (value == null ? '—' : euro.format(value / 100))
const formatDate = (value: string) =>
  new Intl.DateTimeFormat('sq-XK', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Belgrade' }).format(new Date(value))
const period = (subscription: Subscription) =>
  `${formatDate(subscription.current_period_start)} – ${formatDate(subscription.current_period_end)}`
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
// An active subscription ending within a week is highlighted in yellow.
const expiresSoon = (subscription: Subscription) =>
  subscription.status === 'active' && subscription.days_until_expiry <= 7
const daysLabel = (subscription: Subscription) => t('admin.subscriptions.daysValue', { days: subscription.days_until_expiry })

const wide = { class: { th: 'hidden lg:table-cell', td: 'hidden lg:table-cell' } }
const endAligned = { class: { td: 'text-end', th: 'text-end' } }
const columns = computed<TableColumn<Subscription>[]>(() => [
  { id: 'organization', header: t('admin.subscriptions.organization') },
  { id: 'plan', header: t('admin.subscriptions.plan') },
  { id: 'interval', header: t('admin.subscriptions.interval'), meta: wide },
  { id: 'status', header: t('admin.subscriptions.status') },
  { id: 'period', header: t('admin.subscriptions.period'), meta: wide },
  { id: 'price', header: t('admin.subscriptions.price'), meta: endAligned },
  { id: 'days', header: t('admin.subscriptions.daysLeft'), meta: endAligned },
  { id: 'actions', header: '', meta: endAligned },
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
const tableMeta = {
  class: { tr: (row: { original: Subscription }) => (expiresSoon(row.original) ? 'bg-warning/10' : '') },
}
</script>

<template>
  <AdminPage :title="t('admin.nav.subscriptions')">
    <!-- shrink-0: in the flex panel body the card would otherwise shrink and clip rows instead of scrolling. -->
    <UCard ref="listCard" class="shrink-0 scroll-mt-4" :ui="{ header: 'px-3 py-3 sm:px-4 space-y-3', body: 'p-0 sm:p-0' }">
      <template #header>
        <!-- Status tabs on wider screens; on phones the same choice is a select,
             because six tabs do not fit and their labels get cut. -->
        <UTabs
          v-model="filters.status"
          :items="statusTabs"
          :content="false"
          variant="link"
          size="sm"
          class="hidden w-full md:block"
          :ui="{ list: 'flex-wrap', trigger: 'grow-0' }"
        />
        <USelect
          v-model="filters.status"
          :items="statusTabs"
          icon="i-lucide-filter"
          :aria-label="t('admin.subscriptions.status')"
          class="w-full md:hidden"
        />
        <UForm :state="filters" class="flex flex-wrap items-center gap-3">
          <USelect v-model="filters.plan" :items="planOptions" :aria-label="t('admin.subscriptions.plan')" class="w-full sm:w-48" />
          <UCheckbox v-model="filters.expiringSoon" :label="t('admin.subscriptions.expiringWeek')" />
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
          :class="expiresSoon(subscription) ? 'bg-warning/10' : ''"
          :ui="{ root: 'rounded-none ring-0 border-b border-default', body: 'p-4 sm:p-4 space-y-3' }"
        >
          <UFieldGroup class="flex w-full items-start justify-between gap-2">
            <UUser
              :name="subscription.organization_name || subscription.organization_id"
              :description="`${subscription.plan_name} · ${intervalLabel(subscription.billing_interval)} · ${formatCents(subscription.price_cents)}`"
              :avatar="{ alt: subscription.organization_name || '', size: 'sm' }"
              :ui="{ root: 'min-w-0 flex-1', wrapper: 'min-w-0 flex-1', name: 'truncate', description: 'truncate' }"
            />
            <AdminSubscriptionActions
              :organization-id="subscription.organization_id"
              :organization-name="subscription.organization_name"
              :subscription="subscription"
              @changed="refresh()"
            />
          </UFieldGroup>
          <UFieldGroup class="flex flex-wrap items-center gap-1.5">
            <UBadge :color="statusColors[subscription.status] || 'neutral'" variant="subtle" :label="t(`admin.status.${subscription.status}`)" />
            <UBadge color="neutral" variant="soft" icon="i-lucide-calendar" :label="period(subscription)" />
            <UBadge
              :color="expiresSoon(subscription) ? 'warning' : 'neutral'"
              variant="soft"
              icon="i-lucide-hourglass"
              :label="daysLabel(subscription)"
            />
          </UFieldGroup>
        </UCard>
        <UEmpty
          v-if="!subscriptions.length && status !== 'pending'"
          class="md:hidden py-10"
          icon="i-lucide-repeat"
          :title="t('admin.subscriptions.empty')"
        />

        <!-- Tablets and desktops: table; interval and period columns from lg. -->
        <UTable
          class="hidden md:block"
          :data="subscriptions"
          :columns="columns"
          :meta="tableMeta"
          :loading="status === 'pending'"
          :empty="t('admin.subscriptions.empty')"
          :ui="tableUi"
        >
          <template #organization-cell="{ row }">
            <UUser
              :name="row.original.organization_name || row.original.organization_id"
              :avatar="{ alt: row.original.organization_name || '', size: 'xs' }"
              :ui="{ name: 'truncate max-w-48' }"
            />
          </template>
          <template #plan-cell="{ row }">{{ row.original.plan_name }}</template>
          <template #interval-cell="{ row }">{{ intervalLabel(row.original.billing_interval) }}</template>
          <template #status-cell="{ row }">
            <UBadge
              :color="statusColors[row.original.status] || 'neutral'"
              variant="subtle"
              :label="t(`admin.status.${row.original.status}`)"
            />
          </template>
          <template #period-cell="{ row }">{{ period(row.original) }}</template>
          <template #price-cell="{ row }">{{ formatCents(row.original.price_cents) }}</template>
          <template #days-cell="{ row }">
            <UBadge
              :color="expiresSoon(row.original) ? 'warning' : 'neutral'"
              variant="soft"
              class="tabular-nums"
              :label="daysLabel(row.original)"
            />
          </template>
          <template #actions-cell="{ row }">
            <!-- Each action opens a confirmation modal before the PATCH is sent. -->
            <AdminSubscriptionActions
              :organization-id="row.original.organization_id"
              :organization-name="row.original.organization_name"
              :subscription="row.original"
              @changed="refresh()"
            />
          </template>
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
