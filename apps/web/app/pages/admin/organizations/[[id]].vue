<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { AdminOrganizationRow as Organization } from '~/components/AdminOrganizationDetails.vue'

definePageMeta({ layout: 'admin', middleware: 'superadmin' })
const { t } = useI18n()
const { showError } = useFormFeedback()
useSeoMeta({ title: () => `${t('admin.nav.organizations')} · Rrit Admin`, robots: 'noindex, nofollow' })

const route = useRoute()
const router = useRouter()
const statuses = organizationStates
function routeString(value: unknown) {
  return typeof value === 'string' ? value : ''
}
function positiveInteger(value: unknown, fallback: number) {
  const number = Number(routeString(value))
  return Number.isInteger(number) && number > 0 ? number : fallback
}
const page = ref(positiveInteger(route.query.page, 1))
const pageSize = ref(positiveInteger(route.query.per_page, 20))
const filters = reactive({
  search: routeString(route.query.q),
  status: statuses.includes(routeString(route.query.status) as typeof statuses[number]) ? routeString(route.query.status) : 'all',
})
const q = ref(filters.search.trim())

function syncUrl() {
  void router.replace({
    query: {
      ...(q.value ? { q: q.value } : {}),
      ...(filters.status !== 'all' ? { status: filters.status } : {}),
      ...(page.value > 1 ? { page: String(page.value) } : {}),
      ...(pageSize.value !== 20 ? { per_page: String(pageSize.value) } : {}),
    },
  })
}
// Search as the admin types, without a request per keystroke.
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(() => filters.search, (value) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    q.value = value.trim()
  }, 300)
})
watch(q, () => {
  page.value = 1
  syncUrl()
})
watch([() => filters.status, pageSize], () => {
  page.value = 1
  syncUrl()
})
watch(page, syncUrl)

const { data, status: loading, error, refresh } = await useFetch<{ items: Organization[]; total: number }>(
  '/api/admin/organizations',
  {
    // Open the page at once and show loading inside it, instead of blocking navigation.
    lazy: true,
    // No fixed key: each search keeps its own result, so clearing the search
    // brings the full list back instead of the last filtered one.
    query: computed(() => ({
      page: page.value,
      per_page: pageSize.value,
      ...(q.value ? { q: q.value } : {}),
      ...(filters.status !== 'all' ? { status: filters.status } : {}),
    })),
  },
)
watch(error, (value) => {
  if (value) showError(t('admin.organizations.loadError'))
}, { immediate: true })
const organizations = computed(() => data.value?.items || [])
// A new page starts at the top of the list, not where the previous one was scrolled.
const listCard = useTemplateRef<{ $el: HTMLElement }>('listCard')
watch(page, () => {
  listCard.value?.$el.scrollIntoView({ block: 'start', behavior: 'smooth' })
})
// /admin/organizations/[id] opens that organization's details over the list,
// so the details can be linked to (e.g. from the overview) and survive a reload.
const selectedId = computed(() => (typeof route.params.id === 'string' && route.params.id) || null)
function openOrganization(id: string) {
  navigateTo({ path: `/admin/organizations/${id}`, query: route.query })
}
function closeOrganization() {
  navigateTo({ path: '/admin/organizations', query: route.query })
}
// An organization that is not on the current list page is loaded on its own.
const { data: linked, refresh: refreshLinked } = await useFetch<Organization & { brands?: unknown[]; members?: unknown[] }>(
  () => `/api/admin/organizations/${selectedId.value}`,
  { lazy: true, immediate: false, watch: false },
)
watch(
  [selectedId, () => data.value],
  ([id]) => {
    if (id && !organizations.value.some(item => item.id === id)) refreshLinked()
  },
  { immediate: true },
)
// The details follow the refreshed list, so an action is reflected at once.
const selected = computed<Organization | null>(() => {
  if (!selectedId.value) return null
  const listed = organizations.value.find(item => item.id === selectedId.value)
  if (listed) return listed
  const details = linked.value
  if (!details || details.id !== selectedId.value) return null
  return { ...details, brand_count: details.brands?.length ?? 0, member_count: details.members?.length ?? 0 }
})
async function onChanged() {
  await refresh()
  if (selectedId.value && !organizations.value.some(item => item.id === selectedId.value)) await refreshLinked()
}

const statusOptions = computed(() => [
  { label: t('admin.organizations.allStatuses'), value: 'all' },
  ...statuses.map(value => ({ label: t(`admin.organizations.state.${value}`), value })),
])
// The state is decided in the database, so every view reads the same answer.
function stateOf(organization: Organization) {
  return organizationState(organization.state)
}
function formatDay(value: string) {
  return new Intl.DateTimeFormat('sq-XK', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Belgrade' }).format(new Date(value))
}
function credits(organization: Organization) {
  const balance = organization.credit_balance
  return balance ? balance.remaining_credits - balance.reserved_credits : '—'
}
function packageLabel(organization: Organization) {
  const custom = organization.custom_package
  if (!custom) return t('admin.organizations.noPackage')
  return `${custom.name} · ${t('admin.organizations.postsShort', { count: custom.posts_included })}`
}

// Secondary columns appear from large screens; the phone view is a card list.
const wide = { class: { th: 'hidden lg:table-cell', td: 'hidden lg:table-cell' } }
const columns = computed<TableColumn<Organization>[]>(() => [
  { accessorKey: 'name', header: t('admin.organizations.organization') },
  { id: 'subscription', header: t('admin.organizations.package') },
  { id: 'status', header: t('admin.organizations.status') },
  { id: 'credits', header: t('admin.organizations.creditsRemaining') },
  { id: 'brands', header: t('admin.organizations.brands'), meta: wide },
  { id: 'created_at', header: t('admin.organizations.createdAt'), meta: wide },
  { id: 'actions', header: '' },
])
</script>
<template>
  <AdminPage :title="t('admin.nav.organizations')">
    <AdminOrganizationInvite @created="refresh()" />
    <!-- shrink-0: in the flex panel body the card would otherwise shrink and clip rows instead of scrolling. -->
    <UCard ref="listCard" class="shrink-0 scroll-mt-4" :ui="{ body: 'p-0 sm:p-0', header: 'px-3 py-3 sm:px-4' }">
      <template #header>
        <UForm
          :state="filters"
          role="search"
          class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_11rem_10rem]"
        >
          <UInput
            v-model="filters.search"
            icon="i-lucide-search"
            :placeholder="t('admin.organizations.search')"
            :aria-label="t('admin.organizations.search')"
            class="w-full sm:col-span-2 lg:col-span-1"
          />
          <USelect v-model="filters.status" :items="statusOptions" :aria-label="t('admin.organizations.status')" class="w-full" />

        </UForm>
      </template>

      <!-- Phones: one card per organization. -->
        <UCard
          v-for="organization in organizations"
          :key="organization.id"
          class="md:hidden"
          :ui="{ root: 'rounded-none ring-0 border-b border-default', body: 'p-4 sm:p-4 space-y-3' }"
        >
          <UButton
            color="neutral"
            variant="link"
            class="w-full p-0 text-left"
            :aria-label="t('admin.details.open', { name: organization.name })"
            @click="openOrganization(organization.id)"
          >
            <UUser
              :name="organization.name"
              :description="`${organization.slug} · ${formatDay(organization.created_at)}`"
              :avatar="{ alt: organization.name, size: 'sm' }"
              :ui="{ root: 'w-full', wrapper: 'min-w-0 flex-1', name: 'truncate hover:text-primary', description: 'truncate' }"
            />
          </UButton>
          <UFieldGroup class="flex flex-wrap items-center gap-1.5">
            <UBadge
              :color="organization.custom_package?.in_force ? 'success' : 'neutral'"
              :variant="organization.custom_package ? 'subtle' : 'outline'"
              :label="packageLabel(organization)"
            />
            <UBadge
              v-if="organization.custom_package"
              color="neutral"
              variant="soft"
              icon="i-lucide-calendar"
              :label="formatDay(organization.custom_package.ends_at)"
            />
            <UBadge color="neutral" variant="soft" icon="i-lucide-coins" :label="String(credits(organization))" />
            <UBadge
              color="neutral"
              variant="soft"
              icon="i-lucide-users"
              :label="`${organization.brand_count} / ${organization.member_count}`"
            />
            <AdminPackageActions
              :organization-id="organization.id"
              :organization-name="organization.name"
              :package="organization.custom_package"
              @changed="refresh()"
              @edit="openOrganization(organization.id)"
            />
          </UFieldGroup>
        </UCard>
        <UEmpty
          v-if="!organizations.length && loading !== 'pending'"
          class="md:hidden py-10"
          icon="i-lucide-building-2"
          :title="t('admin.organizations.empty')"
        />

        <!-- Tablets and desktops: table; secondary columns from lg. -->
        <UTable
          class="hidden md:block"
          :data="organizations"
          :columns="columns"
          :loading="loading === 'pending'"
          :empty="t('admin.organizations.empty')"
          :ui="{
            root: 'w-full',
            base: 'w-full border-separate border-spacing-0',
            thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
            th: 'py-3 px-4 text-xs font-medium last:w-14',
            td: 'px-4 py-3 border-b border-default text-sm',
            tbody: '[&>tr]:last:[&>td]:border-b-0',
            separator: 'h-0',
          }"
        >
          <template #name-cell="{ row }">
            <UButton
              color="neutral"
              variant="link"
              class="p-0 text-left"
              :aria-label="t('admin.details.open', { name: row.original.name })"
              @click="openOrganization(row.original.id)"
            >
              <UUser
                :name="row.original.name"
                :description="`${row.original.slug} · ${formatDay(row.original.created_at)}`"
                :avatar="{ alt: row.original.name, size: 'sm' }"
                :ui="{ root: 'max-w-72', wrapper: 'min-w-0', name: 'truncate hover:text-primary', description: 'truncate' }"
              />
            </UButton>
          </template>
          <template #subscription-cell="{ row }">
            <UBadge
              :color="row.original.custom_package?.in_force ? 'success' : 'neutral'"
              :variant="row.original.custom_package ? 'subtle' : 'outline'"
              :label="packageLabel(row.original)"
            />
          </template>
          <template #period-cell="{ row }">
            {{ row.original.custom_package ? formatDay(row.original.custom_package.ends_at) : '—' }}
          </template>
          <template #credits-cell="{ row }">
            {{ credits(row.original) }}
          </template>
          <template #status-cell="{ row }">
            <UBadge
              :color="organizationStateColors[stateOf(row.original)]"
              :variant="stateOf(row.original) === 'none' ? 'outline' : 'subtle'"
              :label="t(`admin.organizations.state.${stateOf(row.original)}`)"
            />
          </template>
          <template #brands-cell="{ row }">
            {{ row.original.brand_count }}
          </template>
          <template #created_at-cell="{ row }">
            {{ formatDay(row.original.created_at) }}
          </template>
          <template #usage-cell="{ row }">
            {{ row.original.brand_count }} / {{ row.original.member_count }}
          </template>
          <template #actions-cell="{ row }">
            <AdminPackageActions
              :organization-id="row.original.id"
              :organization-name="row.original.name"
              :package="row.original.custom_package"
              @changed="refresh()"
              @edit="openOrganization(row.original.id)"
            />
          </template>
        </UTable>
    </UCard>
    <AdminOrganizationDetails :organization="selected" @close="closeOrganization" @changed="onChanged" />
    <!-- Pinned to the bottom of the panel so page numbers are always visible. -->
    <template #footer>
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
