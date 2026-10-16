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
  credits_requested: number
  videos_requested: number
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
const deleteConfirmationOpen = ref(false)
const { t } = useI18n()
const note = ref('')
const selectedStatus = ref<AdminPackageRequest['status']>()
type PendingAction = 'delete' | 'save' | 'proposal' | 'note'
const pendingAction = ref<PendingAction | null>(null)
watch(() => props.request?.id, () => {
  note.value = props.request?.handled_note || ''
  selectedStatus.value = undefined
  pendingAction.value = null
}, { immediate: true })
watch(() => props.saving, (saving) => {
  if (!saving) pendingAction.value = null
})

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
        // A request is for posts, for credits, or for both. Showing a zero
        // would read as a request for none, so an unasked-for line is absent.
        ...(request.posts_requested > 0
          ? [
              {
                label: t('admin.requests.posts'),
                value: t('admin.requests.postsValue', { count: request.posts_requested }),
              },
            ]
          : []),
        ...(request.credits_requested > 0
          ? [
              {
                label: t('admin.packages.credits'),
                value: t('admin.packages.creditsValue', { count: request.credits_requested }),
              },
            ]
          : []),
        ...((request.videos_requested ?? 0) > 0
          ? [{ label: t('admin.requests.videos'), value: t('admin.requests.videosValue', { count: request.videos_requested ?? 0 }) }]
          : []),
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
  if (!props.saving && props.request && selectedStatus.value) {
    pendingAction.value = 'save'
    emit('status', selectedStatus.value, note.value)
  }
}
function sendProposal() {
  // The parent opens the proposal form. It persists proposal_sent only after
  // the draft package has been created for the client to review.
  if (!props.saving && props.request) {
    pendingAction.value = 'proposal'
    emit('status', 'won', note.value)
  }
}
function saveNote() {
  if (!props.saving && props.request) {
    pendingAction.value = 'note'
    emit('status', props.request.status, note.value)
  }
}
function removeRequest() {
  if (!props.request) return
  deleteConfirmationOpen.value = true
}
function confirmRemoveRequest() {
  if (!props.request || props.saving) return
  deleteConfirmationOpen.value = false
  pendingAction.value = 'delete'
  emit('remove')
}

</script>
<template>
  <UModal
    :open="!!request"
    :title="request?.contact_name"
    :description="request?.organization_name || request?.business_name || ''"
    :ui="{ content: 'sm:max-w-3xl', body: 'space-y-4' }"
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
        <div class="flex shrink-0 items-center gap-1.5">
          <UButton
            v-if="request?.organization_id"
            type="button"
            color="neutral"
            variant="soft"
            class="h-11 min-w-max shrink-0 justify-center whitespace-nowrap px-3"
            icon="i-lucide-building-2"
            :to="`/admin/organizations/${request.organization_id}`"
            :label="t('admin.requests.openOrganizationShort')"
          />
          <UButton
            type="button"
            color="error"
            variant="ghost"
            class="size-11 justify-center"
            icon="i-lucide-trash-2"
            :loading="saving && pendingAction === 'delete'"
            :aria-label="t('admin.requests.delete')"
            @click.stop.prevent="removeRequest"
          />
        </div>
        <div class="ms-auto grid grid-cols-3 gap-2">
          <USelect
            v-if="canEditStatus"
            v-model="selectedStatus"
            :items="statusOptions"
            :placeholder="t('admin.details.status')"
            class="h-11 w-40"
          />
          <UButton v-if="canEditStatus" type="button" color="neutral" variant="outline" class="h-11 w-40 justify-center" :disabled="!selectedStatus" :loading="saving && pendingAction === 'save'" :label="t('admin.requests.saveChanges')" @click.stop.prevent="saveChanges" />
          <UButton v-if="canSendProposal" type="button" class="h-11 w-40 justify-center" :loading="saving && pendingAction === 'proposal'" :label="t('admin.requests.sendProposal')" @click.stop.prevent="sendProposal" />
          <UButton v-else type="button" color="neutral" variant="outline" class="h-11 w-40 justify-center" :loading="saving && pendingAction === 'note'" :label="t('admin.requests.saveNote')" @click.stop.prevent="saveNote" />
        </div>
      </div>
    </template>
  </UModal>
  <UModal
    :open="deleteConfirmationOpen"
    :title="t('admin.requests.deleteConfirm')"
    :description="request?.contact_name || ''"
    :ui="{ content: 'sm:max-w-xl' }"
    @update:open="(value: boolean) => { if (!value) deleteConfirmationOpen = false }"
  >
    <template #body>
      <p class="mb-4 text-sm text-muted">
        {{ t('admin.requests.deleteWarning') }}
      </p>
      <dl class="space-y-2 rounded-md border border-default bg-elevated/30 p-3 text-sm">
        <div class="flex gap-3">
          <dt class="w-32 shrink-0 whitespace-nowrap text-muted">{{ t('admin.requests.name') }}</dt>
          <dd class="min-w-0 break-words font-medium">{{ request?.contact_name }}</dd>
        </div>
        <div class="flex gap-3">
          <dt class="w-32 shrink-0 whitespace-nowrap text-muted">{{ t('admin.requests.email') }}</dt>
          <dd class="min-w-0 break-words font-medium">{{ request?.contact_email }}</dd>
        </div>
        <div class="flex gap-3">
          <dt class="w-32 shrink-0 whitespace-nowrap text-muted">{{ t('admin.requests.businessName') }}</dt>
          <dd class="min-w-0 break-words font-medium">{{ request?.organization_name || request?.business_name || '—' }}</dd>
        </div>
      </dl>
      <div class="mt-5 flex justify-end gap-2">
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          :label="t('admin.requests.cancel')"
          @click="deleteConfirmationOpen = false"
        />
        <UButton
          type="button"
          color="error"
          :label="t('admin.requests.delete')"
          @click="confirmRemoveRequest"
        />
      </div>
    </template>
  </UModal>
</template>
