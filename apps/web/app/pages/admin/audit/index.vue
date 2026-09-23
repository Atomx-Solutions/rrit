<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

definePageMeta({ layout: 'admin', middleware: 'superadmin' })
const { t } = useI18n()
const { showError } = useFormFeedback()
useSeoMeta({ title: () => `${t('admin.nav.audit')} · Rrit Admin`, robots: 'noindex, nofollow' })

type AuditEvent = {
  id: number
  created_at: string
  action: string
  actor_id: string | null
  actor_email: string | null
  organization_id: string | null
  organization_name: string | null
  resource_type: string
  resource_id: string
  result: string
  metadata: Record<string, unknown>
}
type AuditPage = {
  items: AuditEvent[]
  total: number
  actions: string[]
  organizations: Array<{ id: string, name: string }>
}

const page = ref(1)
const pageSize = ref(20)
const today = new Date().toISOString().slice(0, 10)
const filters = reactive({ organization: 'all', actor: '', action: 'all', from: '', to: '' })
// Actor search waits until the admin stops typing.
const actor = ref('')
let actorTimer: ReturnType<typeof setTimeout> | undefined
watch(() => filters.actor, (value) => {
  clearTimeout(actorTimer)
  actorTimer = setTimeout(() => {
    actor.value = value.trim()
  }, 300)
})
watch([() => filters.organization, actor, () => filters.action, () => filters.from, () => filters.to, pageSize], () => {
  page.value = 1
})

const { data, status, error } = await useFetch<AuditPage>('/api/admin/audit', {
  // Open the page at once and show loading inside it, instead of blocking navigation.
  lazy: true,
  key: 'admin-audit',
  query: computed(() => ({
    page: page.value,
    per_page: pageSize.value,
    ...(filters.organization !== 'all' ? { organization_id: filters.organization } : {}),
    ...(actor.value ? { actor: actor.value } : {}),
    ...(filters.action !== 'all' ? { action: filters.action } : {}),
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {}),
  })),
})
watch(error, (value) => {
  if (value) showError(t('admin.audit.loadError'))
}, { immediate: true })
const events = computed(() => data.value?.items || [])
// A new page starts at the top of the list, not where the previous one was scrolled.
const listCard = useTemplateRef<{ $el: HTMLElement }>('listCard')
watch(page, () => {
  listCard.value?.$el.scrollIntoView({ block: 'start', behavior: 'smooth' })
})

// Filter options come from the log itself, so every choice has results.
const organizationOptions = computed(() => [
  { label: t('admin.audit.allOrganizations'), value: 'all' },
  ...(data.value?.organizations || []).map(organization => ({ label: organization.name, value: organization.id })),
])
const actionOptions = computed(() => [
  { label: t('admin.audit.allActions'), value: 'all' },
  ...(data.value?.actions || []).map(action => ({ label: actionLabel(action), value: action })),
])
const hasFilters = computed(() =>
  filters.organization !== 'all' || !!filters.actor || filters.action !== 'all' || !!filters.from || !!filters.to)
function clearFilters() {
  Object.assign(filters, { organization: 'all', actor: '', action: 'all', from: '', to: '' })
}

const formatTime = (value: string) =>
  new Intl.DateTimeFormat('sq-XK', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    timeZone: 'Europe/Belgrade',
  }).format(new Date(value))
const formatDay = (value: string) =>
  new Intl.DateTimeFormat('sq-XK', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Belgrade' }).format(new Date(value))
const formatClock = (value: string) =>
  new Intl.DateTimeFormat('sq-XK', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Belgrade' }).format(new Date(value))

// "admin_subscription_change.pause" reads as "Subscription · Paused": the part
// before the dot is the area, the part after it what happened. Unknown ones
// fall back to the words themselves, so a new event type never breaks the page.
const areaIcons: Record<string, string> = {
  admin_subscription_change: 'i-lucide-repeat',
  admin_plan_change: 'i-lucide-package',
  admin_credit_pricing_change: 'i-lucide-coins',
  admin_invoice_settings_change: 'i-lucide-receipt-text',
  brand: 'i-lucide-store',
  brand_access: 'i-lucide-key-round',
  creative: 'i-lucide-sparkles',
  membership: 'i-lucide-user-check',
  monthly_plan: 'i-lucide-calendar-range',
  monthly_planner_settings: 'i-lucide-settings',
  organization: 'i-lucide-building-2',
  post: 'i-lucide-file-text',
}
function words(value: string) {
  const text = value.replace(/^admin_/, '').replace(/_change$/, '').replace(/_/g, ' ').trim()
  return text.charAt(0).toUpperCase() + text.slice(1)
}
function actionParts(action: string) {
  const [area = action, ...rest] = action.split('.')
  const step = rest.join('.')
  const areaKey = `admin.audit.areas.${area}`
  const stepKey = `admin.audit.steps.${step}`
  return {
    icon: areaIcons[area] || 'i-lucide-activity',
    area: t(areaKey) === areaKey ? words(area) : t(areaKey),
    step: step ? (t(stepKey) === stepKey ? words(step) : t(stepKey)) : '',
  }
}
const actionLabel = (action: string) => {
  const parts = actionParts(action)
  return parts.step ? `${parts.area} · ${parts.step}` : parts.area
}
// The actor as name + domain, so a long address never needs cutting.
function actorParts(event: AuditEvent) {
  const email = event.actor_email || ''
  const at = email.indexOf('@')
  return at > 0
    ? { name: email.slice(0, at), domain: email.slice(at + 1), full: email }
    : { name: event.actor_id || '—', domain: '', full: event.actor_id || '' }
}

const resultColors: Record<string, 'success' | 'error' | 'warning' | 'neutral'> = {
  succeeded: 'success',
  failed: 'error',
  denied: 'warning',
  cancelled: 'neutral',
}
// The selected event opens in a modal as readable label/value rows.
const selected = ref<AuditEvent | null>(null)
type DetailRow = { label: string, value: string }
// Known fields get a plain-language label; others turn "previous_status"
// into "Previous status". Nested values are shown compactly on one line.
const knownFields = ['status', 'plan_code', 'billing_interval', 'price_cents', 'current_period_start', 'current_period_end', 'days', 'reason', 'action', 'actor_email', 'monthly_cents', 'monthly_credits', 'posts_per_month', 'credit_price_cents', 'vat_rate_basis_points', 'name']
function humanize(key: string) {
  if (knownFields.includes(key)) return t(`admin.audit.fields.${key}`)
  const text = key.replace(/[_.]+/g, ' ').trim()
  return text.charAt(0).toUpperCase() + text.slice(1)
}
const euro = new Intl.NumberFormat('sq-XK', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
// A value in the words the admin uses: statuses and intervals translated,
// cents as euros, basis points as percent, timestamps as local time.
function fieldValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (key === 'status' && typeof value === 'string') return t(`admin.status.${value}`)
  if (key === 'billing_interval') return value === 'annual' ? t('admin.subscriptions.intervalAnnual') : t('admin.subscriptions.intervalMonthly')
  if (key.endsWith('_cents') && typeof value === 'number') return euro.format(value / 100)
  if (key === 'vat_rate_basis_points' && typeof value === 'number') return `${value / 100}%`
  return display(value)
}
function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? t('admin.audit.yes') : t('admin.audit.no')
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value))) return formatTime(value)
  if (typeof value === 'object') return Array.isArray(value) ? value.map(display).join(', ') : Object.entries(value).map(([key, item]) => `${humanize(key)}: ${display(item)}`).join(' · ')
  return String(value)
}
const eventRows = computed<DetailRow[]>(() => {
  const event = selected.value
  if (!event) return []
  return [
    { label: t('admin.audit.time'), value: formatTime(event.created_at) },
    { label: t('admin.audit.type'), value: `${actionLabel(event.action)} (${event.action})` },
    { label: t('admin.audit.result'), value: t(`admin.audit.results.${event.result}`) },
    { label: t('admin.audit.actor'), value: event.actor_email || event.actor_id || '—' },
    { label: t('admin.audit.organization'), value: event.organization_name || t('admin.audit.platform') },
    { label: t('admin.audit.resource'), value: `${event.resource_type} · ${event.resource_id}` },
  ]
})
type ChangeRow = { label: string, before: string, after: string, changed: boolean }
const asObject = (value: unknown) =>
  (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null)
// Before/after side by side, every field once; changed fields first.
const changeRows = computed<ChangeRow[]>(() => {
  const before = asObject(selected.value?.metadata.before)
  const after = asObject(selected.value?.metadata.after)
  if (!before && !after) return []
  const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])]
  return keys
    .map(key => ({
      label: humanize(key),
      before: fieldValue(key, before?.[key]),
      after: fieldValue(key, after?.[key]),
      changed: JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]),
    }))
    .sort((a, b) => Number(b.changed) - Number(a.changed))
})
// One sentence per change, e.g. "Status: Active → Paused".
const summary = computed(() => changeRows.value.filter(row => row.changed).map(row => `${row.label}: ${row.before} → ${row.after}`))
// Everything else in the payload; before/after and repeated fields are shown above.
const shownElsewhere = ['before', 'after', 'event_type', 'organization_id', 'actor_email', 'action']
const metadataRows = computed<DetailRow[]>(() =>
  Object.entries(selected.value?.metadata || {})
    .filter(([key]) => !shownElsewhere.includes(key))
    .map(([key, value]) => ({ label: humanize(key), value: fieldValue(key, value) })))
const changeColumns = computed<TableColumn<ChangeRow>[]>(() => [
  { accessorKey: 'label', header: t('admin.audit.field') },
  { id: 'before', header: t('admin.audit.before') },
  { id: 'after', header: t('admin.audit.after') },
])
const changeUi = {
  thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
  th: 'px-4 py-2 text-xs font-medium',
  td: 'px-4 py-2 text-sm border-b border-default break-all',
  tbody: '[&>tr]:last:[&>td]:border-b-0',
  separator: 'h-0',
}
const detailColumns: TableColumn<DetailRow>[] = [
  { accessorKey: 'label', header: '' },
  { accessorKey: 'value', header: '' },
]
const detailUi = {
  thead: 'hidden',
  td: 'px-4 py-2 text-sm border-b border-default first:w-2/5 first:text-muted break-all',
  tbody: '[&>tr]:last:[&>td]:border-b-0',
  separator: 'h-0',
}

const wide = { class: { th: 'hidden lg:table-cell', td: 'hidden lg:table-cell' } }
const columns = computed<TableColumn<AuditEvent>[]>(() => [
  { id: 'time', header: t('admin.audit.time') },
  { id: 'action', header: t('admin.audit.type') },
  { id: 'actor', header: t('admin.audit.actor') },
  { id: 'organization', header: t('admin.audit.organization'), meta: wide },
  { id: 'details', header: t('admin.audit.details'), meta: { class: { td: 'text-end', th: 'text-end' } } },
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
  <AdminPage :title="t('admin.nav.audit')">
    <!-- shrink-0: in the flex panel body the card would otherwise shrink and clip rows instead of scrolling. -->
    <UCard ref="listCard" class="shrink-0 scroll-mt-4" :ui="{ header: 'px-3 py-3 sm:px-4', body: 'p-0 sm:p-0' }">
      <template #header>
        <UForm :state="filters" class="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_9.5rem_9.5rem_auto]">
          <USelectMenu
            v-model="filters.organization"
            :items="organizationOptions"
            value-key="value"
            :search-input="{ placeholder: t('admin.audit.searchOrganization') }"
            :aria-label="t('admin.audit.organization')"
            class="w-full"
          />
          <UInput
            v-model="filters.actor"
            icon="i-lucide-user-search"
            type="search"
            :placeholder="t('admin.audit.actorPlaceholder')"
            :aria-label="t('admin.audit.actor')"
            class="w-full"
          />
          <USelect v-model="filters.action" :items="actionOptions" :aria-label="t('admin.audit.type')" class="w-full" />
          <UInput v-model="filters.from" type="date" :max="filters.to || today" :aria-label="t('admin.audit.from')" class="w-full" />
          <UInput v-model="filters.to" type="date" :min="filters.from" :max="today" :aria-label="t('admin.audit.to')" class="w-full" />
          <UButton
            v-if="hasFilters"
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            class="justify-self-start"
            :label="t('admin.audit.clearFilters')"
            @click="clearFilters"
          />
        </UForm>
      </template>

      <!-- Phones: one card per event. -->
        <UCard
          v-for="event in events"
          :key="event.id"
          class="md:hidden"
          :ui="{ root: 'rounded-none ring-0 border-b border-default', body: 'p-4 sm:p-4 space-y-3' }"
        >
          <UFieldGroup class="flex w-full items-start justify-between gap-2">
            <UUser
              :name="actionLabel(event.action)"
              :description="`${formatDay(event.created_at)} · ${formatClock(event.created_at)}`"
              :avatar="{ icon: actionParts(event.action).icon, size: 'sm' }"
              :ui="{ root: 'min-w-0 flex-1', wrapper: 'min-w-0 flex-1', name: 'truncate font-medium', description: 'tabular-nums' }"
            />
            <UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-eye" :aria-label="t('admin.audit.show')" @click="selected = event" />
          </UFieldGroup>
          <UFieldGroup class="flex flex-wrap items-center gap-1.5">
            <UBadge :color="resultColors[event.result] || 'neutral'" variant="subtle" :label="t(`admin.audit.results.${event.result}`)" />
            <UBadge color="neutral" variant="soft" icon="i-lucide-user" :label="actorParts(event).full || '—'" class="max-w-full truncate" />
            <UBadge color="neutral" variant="outline" icon="i-lucide-building-2" :label="event.organization_name || t('admin.audit.platform')" />
          </UFieldGroup>
        </UCard>
        <UEmpty
          v-if="!events.length && status !== 'pending'"
          class="md:hidden py-10"
          icon="i-lucide-scroll-text"
          :title="t('admin.audit.empty')"
        />

        <!-- Tablets and desktops. An empty log shows the empty message, never an error. -->
        <UTable
          class="hidden md:block"
          :data="events"
          :columns="columns"
          :loading="status === 'pending'"
          :empty="t('admin.audit.empty')"
          :ui="tableUi"
        >
          <template #time-cell="{ row }">
            <UUser
              :name="formatDay(row.original.created_at)"
              :description="formatClock(row.original.created_at)"
              :ui="{ name: 'tabular-nums whitespace-nowrap', description: 'tabular-nums' }"
            />
          </template>
          <template #action-cell="{ row }">
            <UUser
              :name="actionParts(row.original.action).area"
              :avatar="{ icon: actionParts(row.original.action).icon, size: 'sm' }"
              :ui="{ name: 'font-medium whitespace-nowrap' }"
            >
              <template #description>
                <UBadge
                  :color="resultColors[row.original.result] || 'neutral'"
                  variant="subtle"
                  size="sm"
                  :label="actionParts(row.original.action).step || t(`admin.audit.results.${row.original.result}`)"
                />
              </template>
            </UUser>
          </template>
          <template #actor-cell="{ row }">
            <!-- Name and domain on two lines; hovering shows the full address. -->
            <UTooltip :text="actorParts(row.original).full" :delay-duration="0" :content="{ side: 'top' }">
              <UUser
                :name="actorParts(row.original).name"
                :description="actorParts(row.original).domain"
                :avatar="{ alt: actorParts(row.original).name, size: 'sm' }"
                :ui="{ name: 'truncate max-w-44', description: 'truncate max-w-44' }"
              />
            </UTooltip>
          </template>
          <template #organization-cell="{ row }">
            <UButton
              v-if="row.original.organization_id"
              :to="`/admin/organizations/${row.original.organization_id}`"
              color="neutral"
              variant="soft"
              size="xs"
              icon="i-lucide-building-2"
              :label="row.original.organization_name || row.original.organization_id"
              class="max-w-52"
              :ui="{ label: 'truncate' }"
            />
            <UBadge v-else color="neutral" variant="outline" icon="i-lucide-globe" :label="t('admin.audit.platform')" />
          </template>
          <template #details-cell="{ row }">
            <UButton
              color="neutral"
              variant="outline"
              size="xs"
              icon="i-lucide-eye"
              :label="t('admin.audit.show')"
              @click="selected = row.original"
            />
          </template>
        </UTable>
    </UCard>

    <UModal
      :open="!!selected"
      :title="selected ? actionLabel(selected.action) : ''"
      :description="selected ? formatTime(selected.created_at) : ''"
      :ui="{ content: 'sm:max-w-2xl', body: 'space-y-4' }"
      @update:open="(value: boolean) => { if (!value) selected = null }"
    >
      <template #body>
        <UCard variant="outline" :ui="{ header: 'px-4 py-2.5 sm:px-4', body: 'p-0 sm:p-0' }">
          <template #header>
            <UUser :name="t('admin.audit.event')" :avatar="{ icon: 'i-lucide-scroll-text', size: 'xs' }" />
          </template>
          <UTable :data="eventRows" :columns="detailColumns" :ui="detailUi" />
        </UCard>
        <UAlert
          v-if="summary.length"
          color="primary"
          variant="subtle"
          icon="i-lucide-arrow-right-left"
          :title="t('admin.audit.whatChanged')"
          :description="summary.join(' · ')"
        />
        <UCard v-if="changeRows.length" variant="outline" :ui="{ header: 'px-4 py-2.5 sm:px-4', body: 'p-0 sm:p-0' }">
          <template #header>
            <UUser :name="t('admin.audit.beforeAfter')" :avatar="{ icon: 'i-lucide-git-compare', size: 'xs' }" />
          </template>
          <UTable :data="changeRows" :columns="changeColumns" :ui="changeUi">
            <template #label-cell="{ row }">
              <span :class="row.original.changed ? 'font-medium' : 'text-muted'">{{ row.original.label }}</span>
            </template>
            <template #before-cell="{ row }">
              <UBadge v-if="row.original.changed" color="error" variant="subtle" :label="row.original.before" />
              <span v-else class="text-muted">{{ row.original.before }}</span>
            </template>
            <template #after-cell="{ row }">
              <UBadge v-if="row.original.changed" color="success" variant="subtle" :label="row.original.after" />
              <span v-else class="text-muted">{{ row.original.after }}</span>
            </template>
          </UTable>
        </UCard>
        <UCard v-if="metadataRows.length || !changeRows.length" variant="outline" :ui="{ header: 'px-4 py-2.5 sm:px-4', body: 'p-0 sm:p-0' }">
          <template #header>
            <UUser :name="t('admin.audit.changes')" :avatar="{ icon: 'i-lucide-list', size: 'xs' }" />
          </template>
          <UTable :data="metadataRows" :columns="detailColumns" :empty="t('admin.audit.noChanges')" :ui="detailUi" />
        </UCard>
      </template>
      <template #footer>
        <UButton
          v-if="selected?.organization_id"
          :to="`/admin/organizations/${selected.organization_id}`"
          icon="i-lucide-building-2"
          color="neutral"
          variant="outline"
          :label="t('admin.audit.openOrganization')"
        />
      </template>
    </UModal>

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
