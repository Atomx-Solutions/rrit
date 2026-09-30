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
  status: 'new' | 'contacted' | 'proposal_sent' | 'won' | 'lost'
  handled_note: string | null
  created_at: string
}

const props = defineProps<{ request: AdminPackageRequest | null; saving: boolean }>()
const emit = defineEmits<{
  close: []
  status: [status: AdminPackageRequest['status'], note?: string]
  remove: []
}>()
// Deleting is asked for twice, because the row leaves the inbox for good.
const confirmingDelete = ref(false)
watch(() => props.request?.id, () => {
  confirmingDelete.value = false
})
const { t } = useI18n()
const note = ref('')
const selectedStatus = ref<AdminPackageRequest['status']>()
watch(() => props.request?.id, () => {
  note.value = props.request?.handled_note || ''
  selectedStatus.value = undefined
}, { immediate: true })

const statusColors: Record<AdminPackageRequest['status'], 'info' | 'warning' | 'success' | 'neutral'> = {
  new: 'info',
  contacted: 'warning',
  proposal_sent: 'warning',
  won: 'success',
  lost: 'neutral',
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
const statusOptions = computed<{ label: string; value: AdminPackageRequest['status'] }[]>(() => (['new', 'contacted'] as const).map(value => ({
  label: t(`admin.requests.status.${value}`),
  value,
})))
const canEditStatus = computed(() => ['new', 'contacted'].includes(props.request?.status || ''))
const canSendProposal = computed(() => ['new', 'contacted'].includes(props.request?.status || ''))
function saveChanges() {
  if (props.request && selectedStatus.value) emit('status', selectedStatus.value, note.value)
}
function sendProposal() {
  // The parent opens the proposal form. It persists proposal_sent only after
  // the draft package has been created for the client to review.
  if (props.request) emit('status', 'won', note.value)
}
function saveNote() {
  if (props.request) emit('status', props.request.status, note.value)
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
      <div class="grid gap-3 sm:grid-cols-2">
        <UCard
          v-for="section in sections.slice(0, 2).filter(item => item.rows.length)"
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
      </div>
      <UCard
        v-for="section in sections.slice(2).filter(item => item.rows.length)"
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
      <UCard variant="outline" :ui="{ header: 'px-4 py-2.5 sm:px-4', body: 'p-4 sm:p-4' }">
        <template #header>
          <div class="flex items-center justify-between gap-3 text-sm font-semibold">
            <span class="flex items-center gap-2"><UIcon name="i-lucide-sticky-note" class="size-4 text-muted" />{{ t('admin.requests.note') }}</span>
            <span class="text-xs font-normal text-muted">{{ t('admin.requests.internalNoteHint') }}</span>
          </div>
        </template>
        <UTextarea v-model="note" :maxlength="2000" :rows="3" class="w-full" />
      </UCard>
    </template>
    <template #footer>
      <div class="flex w-full flex-wrap items-center gap-2 border-t border-default pt-3">
        <div class="flex items-center gap-1.5">
          <UButton
            v-if="request?.organization_id"
            color="neutral"
            variant="soft"
            size="sm"
            icon="i-lucide-building-2"
            :to="`/admin/organizations/${request.organization_id}`"
            :label="t('admin.requests.openOrganizationShort')"
          />
          <UButton
            color="error"
            variant="ghost"
            size="sm"
            icon="i-lucide-trash-2"
            :loading="saving"
            :aria-label="confirmingDelete ? t('admin.requests.deleteConfirm') : t('admin.requests.delete')"
            @click="confirmingDelete ? emit('remove') : (confirmingDelete = true)"
          />
        </div>
        <div class="flex w-full flex-wrap items-center justify-end gap-2 min-[800px]:ms-auto min-[800px]:w-auto min-[800px]:flex-nowrap">
          <USelect
            v-if="canEditStatus"
            v-model="selectedStatus"
            :items="statusOptions"
            :placeholder="t('admin.details.status')"
            size="sm"
            class="h-8 w-full min-[480px]:w-56"
          />
          <UButton v-if="canEditStatus" color="neutral" variant="outline" size="sm" :disabled="!selectedStatus" :loading="saving" :label="t('admin.requests.saveChanges')" @click="saveChanges" />
          <UButton v-if="canSendProposal" size="sm" :loading="saving" :label="t('admin.requests.sendProposal')" @click="sendProposal" />
          <UButton v-else color="neutral" variant="outline" size="sm" :loading="saving" :label="t('admin.requests.saveNote')" @click="saveNote" />
        </div>
      </div>
    </template>
  </UModal>
</template>
