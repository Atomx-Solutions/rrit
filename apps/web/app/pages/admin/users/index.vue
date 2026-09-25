<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { AdminUserRow as User } from '~/components/AdminUserDetails.vue'

definePageMeta({ layout: 'admin', middleware: 'superadmin' })
const { t } = useI18n()
const { showError } = useFormFeedback()
useSeoMeta({ title: () => `${t('admin.nav.users')} · Rrit Admin`, robots: 'noindex, nofollow' })

const page = ref(1)
const pageSize = ref(20)
const filters = reactive({ search: '' })
const q = ref('')
// Search as the admin types, without a request per keystroke.
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(() => filters.search, (value) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    q.value = value.trim()
  }, 300)
})
watch([q, pageSize], () => {
  page.value = 1
})

const { data, status: loading, error } = await useFetch<{ items: User[]; total: number }>('/api/admin/users', {
    // Open the page at once and show loading inside it, instead of blocking navigation.
    lazy: true,
  key: 'admin-users',
  query: computed(() => ({
    page: page.value,
    per_page: pageSize.value,
    ...(q.value ? { q: q.value } : {}),
  })),
})
watch(error, (value) => {
  if (value) showError(t('admin.users.loadError'))
}, { immediate: true })
const users = computed(() => data.value?.items || [])
const selectedId = ref<string | null>(null)
const selected = computed(() => users.value.find(user => user.id === selectedId.value) || null)
// A new page starts at the top of the list, not where the previous one was scrolled.
const listCard = useTemplateRef<{ $el: HTMLElement }>('listCard')
watch(page, () => {
  listCard.value?.$el.scrollIntoView({ block: 'start', behavior: 'smooth' })
})

function formatDay(value: string | null) {
  return value
    ? new Intl.DateTimeFormat('sq-XK', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Belgrade' }).format(new Date(value))
    : t('admin.users.never')
}
function roleLabel(role: string) {
  return t(`admin.users.roles.${role}`)
}
// One label per distinct membership role (e.g. "Pronar, Editor").
function roles(user: User) {
  return [...new Set(user.organizations.map(organization => roleLabel(organization.role)))].join(', ')
}

// Secondary columns appear from large screens; the phone view is a card list.
const wide = { class: { th: 'hidden lg:table-cell', td: 'hidden lg:table-cell' } }
const columns = computed<TableColumn<User>[]>(() => [
  { accessorKey: 'email', header: t('admin.users.user') },
  { id: 'organizations', header: t('admin.users.organizations') },
  { id: 'role', header: t('admin.users.role') },
  { id: 'created', header: t('admin.users.createdAt'), meta: wide },
  { id: 'lastSignIn', header: t('admin.users.lastSignIn') },
])
</script>
<template>
  <AdminPage :title="t('admin.nav.users')">
    <!-- shrink-0: in the flex panel body the card would otherwise shrink and clip rows instead of scrolling. -->
    <UCard ref="listCard" class="shrink-0 scroll-mt-4" :ui="{ body: 'p-0 sm:p-0', header: 'px-3 py-3 sm:px-4' }">
      <template #header>
        <UForm :state="filters" role="search">
          <UInput
            v-model="filters.search"
            icon="i-lucide-search"
            type="search"
            :placeholder="t('admin.users.search')"
            :aria-label="t('admin.users.search')"
            class="w-full"
          />
        </UForm>
      </template>

      <!-- Phones: one card per user. -->
        <UCard
          v-for="user in users"
          :key="user.id"
          class="md:hidden"
          :ui="{ root: 'rounded-none ring-0 border-b border-default', body: 'p-4 sm:p-4 space-y-3' }"
        >
          <UButton
            color="neutral"
            variant="link"
            class="w-full p-0 text-left"
            :aria-label="t('admin.details.open', { name: user.email || user.id })"
            @click="selectedId = user.id"
          >
            <UUser
              :name="user.email || user.id"
              :description="`${t('admin.users.createdAt')}: ${formatDay(user.created_at)} · ${t('admin.users.lastSignIn')}: ${formatDay(user.last_sign_in_at)}`"
              :avatar="{ alt: user.email || '', size: 'sm' }"
              :ui="{ root: 'w-full', wrapper: 'min-w-0 flex-1', name: 'truncate hover:text-primary', description: 'line-clamp-2' }"
            />
          </UButton>
          <UFieldGroup class="flex flex-wrap gap-1.5">
            <UButton
              v-for="organization in user.organizations"
              :key="organization.id"
              :to="`/admin/organizations/${organization.id}`"
              color="neutral"
              variant="soft"
              size="xs"
              icon="i-lucide-building-2"
              :label="`${organization.name} · ${roleLabel(organization.role)}`"
            />
          </UFieldGroup>
        </UCard>
        <UEmpty
          v-if="!users.length && loading !== 'pending'"
          class="md:hidden py-10"
          icon="i-lucide-users"
          :title="t('admin.users.empty')"
        />

        <!-- Tablets and desktops: table; secondary columns from lg. -->
        <UTable
          class="hidden md:block"
          :data="users"
          :columns="columns"
          :loading="loading === 'pending'"
          :empty="t('admin.users.empty')"
          :ui="{
            root: 'w-full',
            base: 'w-full border-separate border-spacing-0',
            thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
            th: 'py-3 px-4 text-xs font-medium',
            td: 'px-4 py-3 border-b border-default text-sm',
            tbody: '[&>tr]:last:[&>td]:border-b-0',
            separator: 'h-0',
          }"
        >
          <template #email-cell="{ row }">
            <UButton
              color="neutral"
              variant="link"
              class="p-0 text-left"
              :aria-label="t('admin.details.open', { name: row.original.email || row.original.id })"
              @click="selectedId = row.original.id"
            >
              <UUser
                :name="row.original.email || row.original.id"
                :avatar="{ alt: row.original.email || '', size: 'sm' }"
                :ui="{ root: 'max-w-80', wrapper: 'min-w-0', name: 'truncate hover:text-primary' }"
              />
            </UButton>
          </template>
          <template #organizations-cell="{ row }">
            <UFieldGroup class="flex flex-wrap gap-1.5">
              <!-- Each organization opens its details; a user without one leaves the cell empty. -->
              <UButton
                v-for="organization in row.original.organizations"
                :key="organization.id"
                :to="`/admin/organizations/${organization.id}`"
                color="neutral"
                variant="soft"
                size="xs"
                :label="organization.name"
              />
            </UFieldGroup>
          </template>
          <template #role-cell="{ row }">
            {{ roles(row.original) }}
          </template>
          <template #created-cell="{ row }">
            {{ formatDay(row.original.created_at) }}
          </template>
          <template #lastSignIn-cell="{ row }">
            {{ formatDay(row.original.last_sign_in_at) }}
          </template>
        </UTable>
    </UCard>
    <AdminUserDetails :user="selected" @close="selectedId = null" />
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
