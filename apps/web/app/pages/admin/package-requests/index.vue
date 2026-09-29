<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

definePageMeta({ layout: 'admin', middleware: 'superadmin' })
const { t } = useI18n()
const { showError } = useFormFeedback()
useSeoMeta({
  title: () => `${t('admin.nav.packageRequests')} · Rrit Admin`,
  robots: 'noindex, nofollow',
})

type PackageRequest = {
  id: string
  organization_id: string | null
  organization_name: string | null
  contact_name: string
  contact_email: string
  phone: string | null
  posts_requested: number
  message: string | null
  source: 'landing' | 'app'
  status: 'new' | 'contacted' | 'converted' | 'declined'
  handled_note: string | null
  created_at: string
}

const statuses = ['all', 'new', 'contacted', 'converted', 'declined'] as const
const filter = ref<(typeof statuses)[number]>('new')
const toast = useToast()
const { data, status, error, refresh } = await useFetch<{
  open_count: number
  requests: PackageRequest[]
}>('/api/admin/package-requests', {
  lazy: true,
  query: computed(() => (filter.value === 'all' ? {} : { status: filter.value })),
})
watch(
  error,
  (value) => {
    if (value) showError(t('admin.requests.loadError'))
  },
  { immediate: true },
)
const requests = computed(() => data.value?.requests || [])

const statusColors: Record<PackageRequest['status'], 'info' | 'warning' | 'success' | 'neutral'> = {
  new: 'info',
  contacted: 'warning',
  converted: 'success',
  declined: 'neutral',
}
function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('sq-XK', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Europe/Belgrade',
  }).format(new Date(value))
}

const saving = ref('')
async function setStatus(request: PackageRequest, next: PackageRequest['status']) {
  saving.value = request.id
  try {
    await $fetch(`/api/admin/package-requests/${request.id}`, {
      method: 'PATCH',
      body: { status: next },
    })
    toast.add({ title: t('admin.requests.saved'), color: 'success' })
    await refresh()
  } catch (problem) {
    showError(
      (problem as { data?: { message?: string } }).data?.message || t('admin.requests.saveFailed'),
    )
  } finally {
    saving.value = ''
  }
}

const columns = computed<TableColumn<PackageRequest>[]>(() => [
  { id: 'contact', header: t('admin.requests.contact') },
  { id: 'posts', header: t('admin.requests.posts') },
  { id: 'source', header: t('admin.requests.source') },
  { id: 'created', header: t('admin.requests.created') },
  { id: 'status', header: t('admin.details.status') },
  { id: 'actions', header: '', meta: { class: { td: 'text-end' } } },
])
</script>
<template>
  <AdminPage :title="t('admin.nav.packageRequests')">
    <template #toolbar>
      <USelect
        v-model="filter"
        :items="statuses.map((value) => ({ label: t(`admin.requests.filter.${value}`), value }))"
        class="w-full sm:w-56"
        :aria-label="t('admin.details.status')"
      />
    </template>
    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <UTable
        :data="requests"
        :columns="columns"
        :loading="status === 'pending'"
        :empty="t('admin.requests.empty')"
      >
        <template #contact-cell="{ row }">
          <div class="space-y-0.5">
            <p class="font-medium">
              {{ row.original.contact_name }}
            </p>
            <p class="text-xs text-muted">
              {{ row.original.contact_email
              }}<template v-if="row.original.phone"> · {{ row.original.phone }}</template>
            </p>
            <p v-if="row.original.organization_name" class="text-xs text-muted">
              {{ row.original.organization_name }}
            </p>
            <p v-if="row.original.message" class="text-xs text-muted italic">
              {{ row.original.message }}
            </p>
          </div>
        </template>
        <template #posts-cell="{ row }">
          {{ t('admin.requests.postsValue', { count: row.original.posts_requested }) }}
        </template>
        <template #source-cell="{ row }">
          {{ t(`admin.requests.sourceValue.${row.original.source}`) }}
        </template>
        <template #created-cell="{ row }">
          {{ formatDateTime(row.original.created_at) }}
        </template>
        <template #status-cell="{ row }">
          <UBadge
            :color="statusColors[row.original.status]"
            variant="subtle"
            :label="t(`admin.requests.status.${row.original.status}`)"
          />
        </template>
        <template #actions-cell="{ row }">
          <UFieldGroup>
            <UButton
              v-if="row.original.status === 'new'"
              size="xs"
              color="neutral"
              variant="outline"
              :loading="saving === row.original.id"
              :label="t('admin.requests.markContacted')"
              @click="setStatus(row.original, 'contacted')"
            />
            <UButton
              v-if="row.original.organization_id"
              size="xs"
              color="neutral"
              variant="outline"
              :to="`/admin/organizations/${row.original.organization_id}`"
              :label="t('admin.requests.openOrganization')"
            />
            <UButton
              v-if="row.original.status !== 'converted'"
              size="xs"
              color="neutral"
              variant="outline"
              :loading="saving === row.original.id"
              :label="t('admin.requests.markConverted')"
              @click="setStatus(row.original, 'converted')"
            />
            <UButton
              v-if="row.original.status !== 'declined'"
              size="xs"
              color="neutral"
              variant="ghost"
              :loading="saving === row.original.id"
              :label="t('admin.requests.markDeclined')"
              @click="setStatus(row.original, 'declined')"
            />
          </UFieldGroup>
        </template>
      </UTable>
    </UCard>
  </AdminPage>
</template>
