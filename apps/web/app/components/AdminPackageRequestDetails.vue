<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

export type AdminPackageRequest = {
  id: string
  organization_id: string | null
  organization_name: string | null
  contact_name: string
  contact_email: string
  phone: string | null
  business_name: string | null
  industry: string | null
  platform: 'instagram' | 'facebook' | 'both' | null
  posts_requested: number
  message: string | null
  source: 'landing' | 'app'
  status: 'new' | 'contacted' | 'converted' | 'declined'
  handled_note: string | null
  created_at: string
}

const props = defineProps<{ request: AdminPackageRequest | null; saving: boolean }>()
const emit = defineEmits<{
  close: []
  status: [status: AdminPackageRequest['status']]
  remove: []
}>()
// Deleting is asked for twice, because the row leaves the inbox for good.
const confirmingDelete = ref(false)
watch(() => props.request?.id, () => {
  confirmingDelete.value = false
})
const { t } = useI18n()

const statusColors: Record<AdminPackageRequest['status'], 'info' | 'warning' | 'success' | 'neutral'> = {
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

type Detail = { label: string; value: string }
// A lead is read before it is answered, so the panel shows the request in full
// rather than the summary the list has room for.
const sections = computed(() => {
  const request = props.request
  if (!request) return []
  return [
    {
      title: t('admin.requests.contact'),
      icon: 'i-lucide-user',
      rows: [
        { label: t('admin.requests.name'), value: request.contact_name },
        { label: t('admin.requests.email'), value: request.contact_email },
        { label: t('admin.requests.phone'), value: request.phone || '' },
      ].filter(row => row.value),
    },
    {
      title: t('admin.requests.business'),
      icon: 'i-lucide-store',
      // A request from inside the app carries no business details, because the
      // organization already holds them. Empty rows would only add noise.
      rows: [
        {
          label: t('admin.requests.businessName'),
          value: request.organization_name || request.business_name || '',
        },
        { label: t('admin.requests.industry'), value: request.industry || '' },
        {
          label: t('admin.requests.platform.label'),
          value: request.platform ? t(`admin.requests.platform.${request.platform}`) : '',
        },
      ].filter(row => row.value),
    },
    {
      title: t('admin.requests.request'),
      icon: 'i-lucide-inbox',
      rows: [
        {
          label: t('admin.requests.posts'),
          value: t('admin.requests.postsValue', { count: request.posts_requested }),
        },
        { label: t('admin.requests.source'), value: t(`admin.requests.sourceValue.${request.source}`) },
        { label: t('admin.requests.created'), value: formatDateTime(request.created_at) },
        { label: 'ID', value: request.id },
      ],
    },
  ]
})

const columns: TableColumn<Detail>[] = [
  { accessorKey: 'label', header: '' },
  { accessorKey: 'value', header: '' },
]
const listUi = {
  thead: 'hidden',
  td: 'px-4 py-2 text-sm border-b border-default',
  tbody: '[&>tr]:last:[&>td]:border-b-0',
  separator: 'h-0',
}

</script>
<template>
  <UModal
    :open="!!request"
    :title="request?.contact_name"
    :description="request?.organization_name || request?.business_name || ''"
    :ui="{ content: 'sm:max-w-2xl', body: 'space-y-4' }"
    @update:open="(value: boolean) => { if (!value) emit('close') }"
  >
    <template #body>
      <UBadge
        v-if="request"
        :color="statusColors[request.status]"
        variant="subtle"
        :label="t(`admin.requests.status.${request.status}`)"
      />
      <UCard
        v-for="section in sections.filter(item => item.rows.length)"
        :key="section.title"
        variant="outline"
        :ui="{ header: 'px-4 py-2.5 sm:px-4', body: 'p-0 sm:p-0' }"
      >
        <template #header>
          <div class="flex items-center gap-2 text-sm font-semibold">
            <UIcon :name="section.icon" class="size-4 text-muted" />{{ section.title }}
          </div>
        </template>
        <UTable :data="section.rows" :columns="columns" :ui="listUi" />
      </UCard>
      <UCard
        v-if="request?.message"
        variant="outline"
        :ui="{ header: 'px-4 py-2.5 sm:px-4', body: 'p-4 sm:p-4' }"
      >
        <template #header>
          <div class="flex items-center gap-2 text-sm font-semibold">
            <UIcon name="i-lucide-message-square" class="size-4 text-muted" />{{
              t('admin.requests.message')
            }}
          </div>
        </template>
        <p class="text-sm leading-relaxed whitespace-pre-line">
          {{ request.message }}
        </p>
      </UCard>
      <UAlert
        v-if="request?.handled_note"
        color="neutral"
        variant="subtle"
        icon="i-lucide-sticky-note"
        :title="t('admin.requests.note')"
        :description="request.handled_note"
      />
    </template>
    <template #footer>
      <div class="flex w-full flex-wrap items-center gap-2">
        <UButton
          v-if="request?.organization_id"
          color="neutral"
          variant="ghost"
          icon="i-lucide-building-2"
          :to="`/admin/organizations/${request.organization_id}`"
          :label="t('admin.requests.openOrganization')"
        />
        <UButton
          color="error"
          variant="ghost"
          icon="i-lucide-trash-2"
          :loading="saving"
          :label="confirmingDelete ? t('admin.requests.deleteConfirm') : t('admin.requests.delete')"
          @click="confirmingDelete ? emit('remove') : (confirmingDelete = true)"
        />
        <div class="ms-auto flex flex-wrap items-center gap-2">
          <UButton
            v-if="request && request.status !== 'declined'"
            color="neutral"
            variant="outline"
            :loading="saving"
            :label="t('admin.requests.markDeclined')"
            @click="emit('status', 'declined')"
          />
          <UButton
            v-if="request?.status === 'new'"
            color="neutral"
            variant="outline"
            :loading="saving"
            :label="t('admin.requests.markContacted')"
            @click="emit('status', 'contacted')"
          />
          <UButton
            v-if="request && request.status !== 'converted'"
            :loading="saving"
            :label="t('admin.requests.markConverted')"
            @click="emit('status', 'converted')"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
