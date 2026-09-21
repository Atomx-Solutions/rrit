<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { formatMoney } from '~~/shared/utils/format'

export type AdminOrganizationRow = {
  id: string
  slug: string
  name: string
  status: string
  created_at: string
  subscription: { plan_code: string; plan_name: string; status: string; current_period_end: string; price_cents: number | null } | null
  credit_balance: { remaining_credits: number; reserved_credits: number } | null
  brand_count: number
  member_count: number
}

const props = defineProps<{ organization: AdminOrganizationRow | null }>()
const emit = defineEmits<{ close: []; changed: [] }>()
const { t } = useI18n()
const toast = useToast()

type Detail = { label: string; value: string }
const statusColors: Record<string, 'success' | 'info' | 'warning' | 'error' | 'neutral'> = {
  active: 'success',
  trialing: 'info',
  paused: 'warning',
  past_due: 'error',
  cancelled: 'neutral',
  expired: 'neutral',
}
function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('sq-XK', { dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23', timeZone: 'Europe/Belgrade' }).format(new Date(value))
}

const sections = computed(() => {
  const organization = props.organization
  if (!organization) return []
  const subscription = organization.subscription
  const balance = organization.credit_balance
  return [
    {
      title: t('admin.details.organization'),
      icon: 'i-lucide-building-2',
      rows: [
        { label: t('admin.details.name'), value: organization.name },
        { label: t('admin.details.slug'), value: organization.slug },
        { label: t('admin.details.status'), value: t(`admin.organizationStatus.${organization.status}`) },
        { label: t('admin.details.createdAt'), value: formatDateTime(organization.created_at) },
        { label: 'ID', value: organization.id },
      ],
    },
    {
      title: t('admin.details.subscription'),
      icon: 'i-lucide-repeat',
      rows: subscription
        ? [
            { label: t('admin.details.plan'), value: `${subscription.plan_name} (${subscription.plan_code})` },
            { label: t('admin.details.status'), value: t(`admin.status.${subscription.status}`) },
            { label: t('admin.details.price'), value: subscription.price_cents == null ? '—' : formatMoney(subscription.price_cents / 100) },
            { label: t('admin.details.periodEnd'), value: formatDateTime(subscription.current_period_end) },
          ]
        : [{ label: t('admin.details.plan'), value: t('admin.organizations.noSubscription') }],
    },
    {
      title: t('admin.details.credits'),
      icon: 'i-lucide-coins',
      rows: balance
        ? [
            { label: t('admin.details.remaining'), value: String(balance.remaining_credits) },
            { label: t('admin.details.reserved'), value: String(balance.reserved_credits) },
            { label: t('admin.details.spendable'), value: String(balance.remaining_credits - balance.reserved_credits) },
          ]
        : [{ label: t('admin.details.remaining'), value: '—' }],
    },
    {
      title: t('admin.details.usage'),
      icon: 'i-lucide-users',
      rows: [
        { label: t('admin.details.brands'), value: String(organization.brand_count) },
        { label: t('admin.details.members'), value: String(organization.member_count) },
      ],
    },
  ]
})

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
    :ui="{ content: 'sm:max-w-2xl', body: 'space-y-4' }"
    @update:open="(value: boolean) => { if (!value) emit('close') }"
  >
    <template #body>
      <UBadge
        v-if="organization"
        :color="organization.subscription ? statusColors[organization.subscription.status] || 'neutral' : 'neutral'"
        :variant="organization.subscription ? 'subtle' : 'outline'"
        :label="organization.subscription
          ? `${organization.subscription.plan_name} · ${t(`admin.status.${organization.subscription.status}`)}`
          : t('admin.organizations.noSubscription')"
      />
      <UCard
        v-for="section in sections"
        :key="section.title"
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
    </template>
    <template #footer>
      <UButton
        v-if="organization"
        icon="i-lucide-copy"
        color="neutral"
        variant="ghost"
        :label="t('admin.details.copyId')"
        @click="copyId"
      />
      <AdminSubscriptionActions
        v-if="organization"
        :organization-id="organization.id"
        :organization-name="organization.name"
        :subscription="organization.subscription"
        @changed="emit('changed')"
      />
    </template>
  </UModal>
</template>
