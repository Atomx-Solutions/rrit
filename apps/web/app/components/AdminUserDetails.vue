<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

export type AdminUserRow = {
  id: string
  email: string | null
  created_at: string
  last_sign_in_at: string | null
  organizations: Array<{ id: string; name: string; role: string }>
}

const props = defineProps<{ user: AdminUserRow | null }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const toast = useToast()

type Detail = { label: string; value: string }
function formatDateTime(value: string | null) {
  return value
    ? new Intl.DateTimeFormat('sq-XK', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Belgrade' }).format(new Date(value))
    : t('admin.users.never')
}

const account = computed<Detail[]>(() => {
  const user = props.user
  if (!user) return []
  return [
    { label: t('admin.userDetails.email'), value: user.email || '—' },
    { label: t('admin.users.createdAt'), value: formatDateTime(user.created_at) },
    { label: t('admin.users.lastSignIn'), value: formatDateTime(user.last_sign_in_at) },
    { label: 'ID', value: user.id },
  ]
})
const organizations = computed<Detail[]>(() =>
  (props.user?.organizations || []).map(organization => ({
    label: organization.name,
    value: t(`admin.users.roles.${organization.role}`),
  })),
)
const columns: TableColumn<Detail>[] = [
  { accessorKey: 'label', header: '' },
  { accessorKey: 'value', header: '' },
]
const tableUi = {
  thead: 'hidden',
  td: 'px-4 py-2 text-sm border-b border-default first:w-2/5 first:text-muted break-all',
  tbody: '[&>tr]:last:[&>td]:border-b-0',
  separator: 'h-0',
}

async function copy(value: string | null | undefined, message: string) {
  if (!value) return
  await navigator.clipboard.writeText(value)
  toast.add({ title: message, color: 'success' })
}
</script>
<template>
  <UModal
    :open="!!user"
    :title="user?.email || user?.id"
    :description="t('admin.userDetails.description')"
    :ui="{ content: 'sm:max-w-2xl', body: 'space-y-4' }"
    @update:open="(value: boolean) => { if (!value) emit('close') }"
  >
    <template #body>
      <UCard variant="outline" :ui="{ header: 'px-4 py-2.5 sm:px-4', body: 'p-0 sm:p-0' }">
        <template #header>
          <UButton
            icon="i-lucide-user-round"
            :label="t('admin.userDetails.account')"
            color="neutral"
            variant="link"
            class="p-0 font-semibold pointer-events-none"
            tabindex="-1"
          />
        </template>
        <UTable :data="account" :columns="columns" :ui="tableUi" />
      </UCard>
      <UCard variant="outline" :ui="{ header: 'px-4 py-2.5 sm:px-4', body: 'p-0 sm:p-0' }">
        <template #header>
          <UButton
            icon="i-lucide-building-2"
            :label="`${t('admin.users.organizations')} (${organizations.length})`"
            color="neutral"
            variant="link"
            class="p-0 font-semibold pointer-events-none"
            tabindex="-1"
          />
        </template>
        <UTable :data="organizations" :columns="columns" :ui="tableUi" :empty="t('admin.users.noOrganization')" />
      </UCard>
    </template>
    <template #footer>
      <UButton
        icon="i-lucide-copy"
        color="neutral"
        variant="ghost"
        :label="t('admin.userDetails.copyEmail')"
        :disabled="!user?.email"
        @click="copy(user?.email, t('admin.userDetails.emailCopied'))"
      />
      <UButton
        icon="i-lucide-copy"
        color="neutral"
        variant="ghost"
        :label="t('admin.details.copyId')"
        @click="copy(user?.id, t('admin.details.idCopied'))"
      />
    </template>
  </UModal>
</template>
