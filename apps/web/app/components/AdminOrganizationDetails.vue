<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { formatMoney } from '~~/shared/utils/format'

export type AdminOrganizationRow = {
  id: string
  slug: string
  name: string
  status: string
  // Decided in the database so the badge here matches the list exactly.
  state: 'active' | 'trialing' | 'paused' | 'draft' | 'expired' | 'cancelled' | 'none'
  created_at: string
  subscription: { plan_code: string; plan_name: string; status: string; current_period_end: string; price_cents: number | null } | null
  // The negotiated package the organization holds, which is what it may
  // generate against. Older organizations may still carry only a subscription.
  custom_package: {
    id: string
    name: string
    posts_included: number
    price_cents: number
    starts_at: string
    ends_at: string
    status: 'draft' | 'active' | 'expired' | 'cancelled'
    in_force: boolean
  } | null
  credit_balance: { remaining_credits: number; reserved_credits: number } | null
  brand_count: number
  member_count: number
}

const props = defineProps<{ organization: AdminOrganizationRow | null }>()
const emit = defineEmits<{ close: []; changed: [] }>()
const { t } = useI18n()
const toast = useToast()

type Detail = { label: string; value: string }
type Member = { user_id: string; email: string | null; role: string; status: string; created_at: string }
type Brand = { id: string; name: string; category: string; status: string }
type Details = {
  members: Member[]
  brands: Brand[]
  subscription: { current_period_start: string; current_period_end: string } | null
}
// Members, brands and the period start come from the details endpoint,
// loaded when an organization is opened and again after an action.
const detailsId = computed(() => props.organization?.id)
const { data: details, status: detailsStatus, execute: loadDetails } = useFetch<Details>(
  () => `/api/admin/organizations/${detailsId.value}`,
  { immediate: false, watch: false },
)
watch(detailsId, (id) => {
  if (id) void loadDetails()
}, { immediate: true })
const memberStatusColors: Record<string, 'success' | 'warning' | 'neutral'> = { active: 'success', suspended: 'warning' }
const brandStatusColors: Record<string, 'success' | 'neutral'> = { active: 'success', archived: 'neutral' }
function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('sq-XK', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Belgrade' }).format(new Date(value))
}

// One card per step, so a step is never a scroll. The subscription is gone from
// here: what an organization holds is its package, and that has its own step.
const organizationRows = computed(() => {
  const organization = props.organization
  if (!organization) return []
  return [
    { label: t('admin.details.name'), value: organization.name },
    { label: t('admin.details.slug'), value: organization.slug },
    { label: t('admin.details.status'), value: t(`admin.organizationStatus.${organization.status}`) },
    { label: t('admin.details.createdAt'), value: formatDateTime(organization.created_at) },
    { label: 'ID', value: organization.id },
  ]
})
const creditRows = computed(() => {
  const balance = props.organization?.credit_balance
  if (!balance) return [{ label: t('admin.details.remaining'), value: '—' }]
  return [
    { label: t('admin.details.remaining'), value: String(balance.remaining_credits) },
    { label: t('admin.details.reserved'), value: String(balance.reserved_credits) },
    {
      label: t('admin.details.spendable'),
      value: String(balance.remaining_credits - balance.reserved_credits),
    },
  ]
})

type AdminInvoice = { id: string; number: string; kind: 'invoice' | 'credit_note'; issuedAt: string; currency: string; total: number; lines: Array<{ description: string }> }
// Invoices load when an organization is opened, not with the whole list.
const organizationId = computed(() => props.organization?.id)
const { data: invoiceData, status: invoiceStatus, execute: loadInvoices } = useFetch<{ invoices: AdminInvoice[] }>(
  () => `/api/admin/organizations/${organizationId.value}/invoices`,
  { immediate: false, watch: false },
)
watch(organizationId, (id) => {
  if (id) void loadInvoices()
}, { immediate: true })
const preview = ref<AdminInvoice | null>(null)
const previewUrl = computed(() =>
  preview.value ? `/api/admin/organizations/${organizationId.value}/invoices/${preview.value.id}/pdf?inline=1` : '',
)
function formatDay(value: string) {
  return new Intl.DateTimeFormat('sq-XK', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Belgrade' }).format(new Date(value))
}

// The ten most recent invoices; the full history is on the billing page.
const latestInvoices = computed(() => (invoiceData.value?.invoices || []).slice(0, 10))
const steps = computed(() => [
  { key: 'overview', label: t('admin.details.stepOverview') },
  { key: 'packages', label: t('admin.details.stepPackages') },
  { key: 'credits', label: t('admin.details.stepCredits') },
  { key: 'members', label: t('admin.details.stepMembers', { count: details.value?.members.length ?? 0 }) },
  { key: 'brands', label: t('admin.details.stepBrands', { count: details.value?.brands.length ?? 0 }) },
  { key: 'invoices', label: t('admin.details.stepInvoices', { count: latestInvoices.value.length }) },
])
const step = ref(0)
// A package to open for editing, from "Edit package" here or on the list.
const route = useRoute()
const editPackageId = ref<string | null>(null)
function editPackage(id: string | null | undefined) {
  if (!id) return
  editPackageId.value = id
  step.value = steps.value.findIndex(item => item.key === 'packages')
}
function packageEditOpened() {
  editPackageId.value = null
  if (route.query.editPackage) {
    const { editPackage: _editPackage, ...query } = route.query
    void navigateTo({ query }, { replace: true })
  }
}
watch(() => props.organization?.id, () => {
  step.value = 0
  editPackage(typeof route.query.editPackage === 'string' ? route.query.editPackage : null)
}, { immediate: true })
const currentStep = computed(() => steps.value[step.value]?.key ?? 'overview')
// The steps double as a navigation bar, so a section can be reached directly
// instead of only by walking through the ones before it.
const stepItems = computed(() => steps.value.map(item => ({ label: item.label, value: item.key })))
const activeStep = computed({
  get: () => currentStep.value,
  set: (value: string) => {
    const index = steps.value.findIndex(item => item.key === value)
    if (index >= 0) step.value = index
  },
})
const memberColumns = computed<TableColumn<Member>[]>(() => [
  { accessorKey: 'email', header: t('admin.details.email') },
  { id: 'role', header: t('admin.users.role') },
  { id: 'status', header: t('admin.details.status') },
  { id: 'joined', header: t('admin.details.joinedAt'), meta: { class: { td: 'text-end whitespace-nowrap', th: 'text-end' } } },
])
const brandColumns = computed<TableColumn<Brand>[]>(() => [
  { accessorKey: 'name', header: t('admin.details.name') },
  { accessorKey: 'category', header: t('admin.details.category') },
  { id: 'status', header: t('admin.details.status'), meta: { class: { td: 'text-end', th: 'text-end' } } },
])
const listUi = {
  thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
  th: 'px-4 py-2 text-xs font-medium',
  td: 'px-4 py-2 text-sm border-b border-default',
  tbody: '[&>tr]:last:[&>td]:border-b-0',
  separator: 'h-0',
}
// After an action the modal, its lists and the page behind it all refresh.
function onSubscriptionChanged() {
  void loadDetails()
  void loadInvoices()
  emit('changed')
}

const invoiceColumns: TableColumn<AdminInvoice>[] = [
  { accessorKey: 'number', header: '' },
  { id: 'total', header: '', meta: { class: { td: 'text-end whitespace-nowrap' } } },
  { id: 'pdf', header: '', meta: { class: { td: 'text-end whitespace-nowrap' } } },
]
const columns: TableColumn<Detail>[] = [
  { accessorKey: 'label', header: '' },
  { accessorKey: 'value', header: '' },
]

async function copyId() {
  if (!props.organization) return
  await navigator.clipboard.writeText(props.organization.id)
  toast.add({ title: t('admin.details.idCopied'), color: 'success' })
}
</script>
<template>
  <UModal
    :open="!!organization"
    :title="organization?.name"
    :description="organization?.slug"
    :ui="{ content: 'sm:max-w-5xl', body: 'space-y-4' }"
    @update:open="(value: boolean) => { if (!value) emit('close') }"
  >
    <template #body>
      <UTabs
        v-model="activeStep"
        :items="stepItems"
        :content="false"
        size="sm"
        :aria-label="organization?.name"
        :ui="{ list: 'w-full overflow-x-auto' }"
      />
      <UBadge
        v-if="organization"
        :color="organizationStateColors[organizationState(organization.state)]"
        :variant="organization.state === 'none' ? 'outline' : 'subtle'"
        :label="organization.custom_package
          ? `${organization.custom_package.name} · ${t(`admin.organizations.state.${organizationState(organization.state)}`)}`
          : t(`admin.organizations.state.${organizationState(organization.state)}`)"
      />
      <UCard
        v-for="section in [
          { key: 'overview', title: t('admin.details.organization'), icon: 'i-lucide-building-2', rows: organizationRows },
          { key: 'credits', title: t('admin.details.credits'), icon: 'i-lucide-coins', rows: creditRows },
        ].filter(item => item.key === currentStep)"
        :key="section.key"
        variant="outline"
        :ui="{ header: 'px-4 py-2.5 sm:px-4', body: 'p-0 sm:p-0' }"
      >
        <template #header>
          <UButton
            :icon="section.icon"
            :label="section.title"
            color="neutral"
            variant="link"
            class="p-0 font-semibold pointer-events-none"
            tabindex="-1"
          />
        </template>
        <UTable
          :data="section.rows"
          :columns="columns"
          :ui="{
            thead: 'hidden',
            td: 'px-4 py-2 text-sm border-b border-default first:w-2/5 first:text-muted break-all',
            tbody: '[&>tr]:last:[&>td]:border-b-0',
            separator: 'h-0',
          }"
        />
      </UCard>
      <UCard v-if="currentStep === 'members'" variant="outline" :ui="{ header: 'px-4 py-2.5 sm:px-4', body: 'p-0 sm:p-0' }">
        <template #header>
          <UButton
            icon="i-lucide-users"
            :label="`${t('admin.details.members')} (${details?.members.length ?? organization?.member_count ?? 0})`"
            color="neutral"
            variant="link"
            class="p-0 font-semibold pointer-events-none"
            tabindex="-1"
          />
        </template>
        <UTable
          :data="details?.members || []"
          :columns="memberColumns"
          :loading="detailsStatus === 'pending'"
          :empty="t('admin.details.noMembers')"
          :ui="listUi"
        >
          <template #email-cell="{ row }">
            <UUser :name="row.original.email || row.original.user_id" :ui="{ name: 'truncate max-w-48 sm:max-w-64' }" />
          </template>
          <template #role-cell="{ row }">{{ t(`admin.users.roles.${row.original.role}`) }}</template>
          <template #status-cell="{ row }">
            <UBadge :color="memberStatusColors[row.original.status] || 'neutral'" variant="subtle" :label="t(`admin.details.memberStatus.${row.original.status}`)" />
          </template>
          <template #joined-cell="{ row }">{{ formatDay(row.original.created_at) }}</template>
        </UTable>
      </UCard>
      <UCard v-if="currentStep === 'brands'" variant="outline" :ui="{ header: 'px-4 py-2.5 sm:px-4', body: 'p-0 sm:p-0' }">
        <template #header>
          <UButton
            icon="i-lucide-store"
            :label="`${t('admin.details.brands')} (${details?.brands.length ?? organization?.brand_count ?? 0})`"
            color="neutral"
            variant="link"
            class="p-0 font-semibold pointer-events-none"
            tabindex="-1"
          />
        </template>
        <UTable
          :data="details?.brands || []"
          :columns="brandColumns"
          :loading="detailsStatus === 'pending'"
          :empty="t('admin.details.noBrands')"
          :ui="listUi"
        >
          <template #status-cell="{ row }">
            <UBadge :color="brandStatusColors[row.original.status] || 'neutral'" variant="subtle" :label="t(`admin.details.brandStatus.${row.original.status}`)" />
          </template>
        </UTable>
      </UCard>
      <AdminCustomPackages
        v-if="organization && currentStep === 'packages'"
        :organization-id="organization.id"
        :organization-name="organization.name"
        :edit-package-id="editPackageId"
        @edit-opened="packageEditOpened"
      />
      <UCard v-if="currentStep === 'invoices'" variant="outline" :ui="{ header: 'px-4 py-2.5 sm:px-4', body: 'p-0 sm:p-0' }">
        <template #header>
          <UButton
            icon="i-lucide-receipt-text"
            :label="`${t('admin.details.latestInvoices')} (${latestInvoices.length})`"
            color="neutral"
            variant="link"
            class="p-0 font-semibold pointer-events-none"
            tabindex="-1"
          />
        </template>
        <UTable
          :data="latestInvoices"
          :columns="invoiceColumns"
          :loading="invoiceStatus === 'pending'"
          :empty="t('admin.details.noInvoices')"
          :ui="{
            thead: 'hidden',
            td: 'px-4 py-2 text-sm border-b border-default',
            tbody: '[&>tr]:last:[&>td]:border-b-0',
            separator: 'h-0',
          }"
        >
          <template #number-cell="{ row }">
            <UUser
              :name="row.original.number"
              :description="`${formatDay(row.original.issuedAt)} · ${row.original.lines.map(line => line.description).join(', ')}`"
              :ui="{ name: 'tabular-nums', description: 'line-clamp-1' }"
            />
          </template>
          <template #total-cell="{ row }">
            <UBadge v-if="row.original.kind === 'credit_note'" color="neutral" variant="subtle" :label="t('billing.creditNote')" class="me-2" />
            <UBadge color="neutral" variant="soft" :label="formatMoney(row.original.total, row.original.currency)" />
          </template>
          <template #pdf-cell="{ row }">
            <UButton
              icon="i-lucide-eye"
              color="neutral"
              variant="ghost"
              size="xs"
              :label="t('admin.details.previewInvoice')"
              class="me-1"
              @click="preview = row.original"
            />
            <UButton
              :to="`/api/admin/organizations/${organization?.id}/invoices/${row.original.id}/pdf`"
              external
              download
              icon="i-lucide-download"
              color="neutral"
              variant="outline"
              size="xs"
              label="PDF"
              :aria-label="t('billing.downloadInvoice', { number: row.original.number })"
            />
          </template>
        </UTable>
      </UCard>
    </template>
    <template #footer>
      <div class="flex w-full flex-wrap items-center gap-2">
        <div class="ms-auto flex flex-wrap items-center gap-2">
          <UButton
            v-if="organization"
            icon="i-lucide-copy"
            color="neutral"
            variant="ghost"
            :label="t('admin.details.copyId')"
            @click="copyId"
          />
          <AdminPackageActions
            v-if="organization"
            :organization-id="organization.id"
            :organization-name="organization.name"
            :package="organization.custom_package"
            @changed="onSubscriptionChanged"
            @edit="editPackage(organization.custom_package?.id)"
          />
        </div>
      </div>
    </template>
  </UModal>
  <UModal
    :open="!!preview"
    :title="preview?.number"
    :description="organization?.name"
    :ui="{ content: 'sm:max-w-4xl h-[90dvh]', body: 'p-0 sm:p-0 flex-1' }"
    @update:open="(value: boolean) => { if (!value) preview = null }"
  >
    <template #body>
      <iframe v-if="previewUrl" :src="previewUrl" :title="preview?.number" class="h-full min-h-[70dvh] w-full border-0" />
    </template>
    <template #footer>
      <UButton
        v-if="preview"
        :to="previewUrl.replace('?inline=1', '')"
        external
        download
        icon="i-lucide-download"
        color="neutral"
        variant="outline"
        label="PDF"
      />
    </template>
  </UModal>
</template>
