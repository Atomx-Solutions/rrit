<script setup lang="ts">
import { z } from 'zod'

export type AdminInvitation = {
  id: string
  organization_id: string
  organization_name: string
  organization_slug: string
  email: string
  role: string
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  expires_at: string
  updated_at: string
  accepted_at: string | null
  created_at: string
}
type InvitationForm = { name: string; slug: string; email: string; expires_minutes: number }

const emit = defineEmits<{ created: [] }>()
const { t } = useI18n()
const { onFormError, showError, showSuccess } = useFormFeedback()

const open = ref(false)
const deleteOpen = ref(false)
const deleteTarget = ref<AdminInvitation | null>(null)
const deleting = ref(false)
const saving = ref(false)
const now = ref(Date.now())
let countdownTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  countdownTimer = setInterval(() => { now.value = Date.now() }, 1000)
})
onBeforeUnmount(() => {
  if (countdownTimer) clearInterval(countdownTimer)
})
// The link exists in one place only, for as long as this panel stays open.
// Nothing can recover it afterwards, so the panel does not close by itself.
const issuedUrl = ref('')
const resendTarget = ref<AdminInvitation | null>(null)
const reactivatingId = ref<string | null>(null)
watch(open, (isOpen) => {
  if (!isOpen && !saving.value) reactivatingId.value = null
})

const empty = () => ({ name: '', slug: '', email: '', expires_minutes: 5 })
const form = reactive<InvitationForm>(empty())
const expiryHours = ref(0)
const expiryMinutes = ref(5)
const hourOptions = Array.from({ length: 25 }, (_, value) => ({ label: `${value}h`, value }))
const minuteOptions = Array.from({ length: 12 }, (_, index) => ({ label: `${index * 5}m`, value: index * 5 }))
watch([expiryHours, expiryMinutes], ([hours, minutes]) => {
  form.expires_minutes = Math.min(1440, Math.max(1, hours * 60 + minutes))
})
const slugTouched = ref(false)

// Every rule carries its own message: a rule left without one falls back to
// zod's English default and shows up untranslated in the form.
const schema = z.object({
  name: z
    .string()
    .trim()
    .min(2, t('admin.invitations.nameInvalid'))
    .max(120, t('admin.invitations.nameTooLong')),
  slug: z
    .string()
    .trim()
    .min(2, t('admin.invitations.slugInvalid'))
    .max(80, t('admin.invitations.slugTooLong'))
    .regex(/^[a-z0-9][a-z0-9-]*$/, t('admin.invitations.slugInvalid')),
  email: z
    .email(t('admin.invitations.emailInvalid'))
    .max(320, t('admin.invitations.emailInvalid')),
  expires_minutes: z
    .number(t('admin.invitations.expiresInvalid'))
    .int(t('admin.invitations.expiresInvalid'))
    .min(1, t('admin.invitations.expiresInvalid'))
    .max(1440, t('admin.invitations.expiresInvalid')),
})

// A slug the superadmin has not edited follows the organization name.
watch(
  () => form.name,
  (name) => {
    if (slugTouched.value) return
    form.slug = name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80)
  },
)

const { data, status, refresh } = await useFetch<AdminInvitation[]>('/api/admin/invitations', {
  lazy: true,
  default: () => [],
})

const search = ref('')
const statusFilter = ref<'all' | AdminInvitation['status']>('all')
const statusOptions = computed(() => [
  { label: t('admin.invitations.allStatuses'), value: 'all' },
  ...(['pending', 'accepted', 'revoked', 'expired'] as const).map(value => ({ label: t(`admin.invitations.status.${value}`), value })),
])
const filteredInvitations = computed(() => {
  const query = search.value.trim().toLowerCase()
  return (data.value || []).filter((invitation) => {
    const matchesSearch = !query || `${invitation.organization_name} ${invitation.email}`.toLowerCase().includes(query)
    return matchesSearch && (statusFilter.value === 'all' || invitationStatus(invitation) === statusFilter.value)
  })
})

function invitationStatus(invitation: AdminInvitation): AdminInvitation['status'] {
  if (invitation.status === 'pending' && new Date(invitation.expires_at).getTime() <= now.value) return 'expired'
  return invitation.status
}

function openPanel() {
  Object.assign(form, empty())
  expiryHours.value = 0
  expiryMinutes.value = 5
  slugTouched.value = false
  issuedUrl.value = ''
  resendTarget.value = null
  open.value = true
}

function problem(error: unknown) {
  const message = (error as { data?: { message?: string } })?.data?.message
  return message ? t(message as never) : t('admin.invitations.failed')
}

async function create() {
  if (saving.value) return
  saving.value = true
  try {
    const result = resendTarget.value
      ? await $fetch<{ url: string }>(`/api/admin/invitations/${resendTarget.value.id}/resend`, {
          method: 'POST',
          body: { expires_minutes: form.expires_minutes },
        })
      : await $fetch<{ url: string }>('/api/admin/invitations', {
          method: 'POST',
          body: { ...form, role: 'owner' },
        })
    issuedUrl.value = result.url
    await refresh()
    emit('created')
  } catch (error) {
    showError(problem(error))
  } finally {
    saving.value = false
    reactivatingId.value = null
  }
}

async function revoke(invitation: AdminInvitation) {
  try {
    // requireSameOrigin only accepts a JSON request, and $fetch sets no
    // content type for a POST without a body.
    await $fetch(`/api/admin/invitations/${invitation.id}/revoke`, {
      method: 'POST',
      body: {},
    })
    await refresh()
  } catch (error) {
    showError(problem(error))
  }
}

async function remove(invitation: AdminInvitation) {
  deleteTarget.value = invitation
  deleteOpen.value = true
}

async function confirmRemove() {
  if (!deleteTarget.value || deleting.value) return
  deleting.value = true
  try {
    await $fetch(`/api/admin/invitations/${deleteTarget.value.id}/delete`, { method: 'POST', body: {} })
    deleteOpen.value = false
    deleteTarget.value = null
    await refresh()
  } catch (error) {
    showError(problem(error))
  } finally {
    deleting.value = false
  }
}

async function resend(invitation: AdminInvitation) {
  if (reactivatingId.value) return
  reactivatingId.value = invitation.id
  resendTarget.value = invitation
  Object.assign(form, {
    name: invitation.organization_name,
    slug: invitation.organization_slug,
    email: invitation.email,
    expires_minutes: 5,
  })
  expiryHours.value = 0
  expiryMinutes.value = 5
  issuedUrl.value = ''
  open.value = true
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(issuedUrl.value)
    showSuccess(t('admin.invitations.copied'))
  } catch {
    showError(t('admin.invitations.copyFailed'))
  }
}

const statusColors: Record<AdminInvitation['status'], 'info' | 'success' | 'neutral' | 'warning'> = {
  pending: 'info',
  accepted: 'success',
  revoked: 'neutral',
  expired: 'warning',
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('sq-XK', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Belgrade',
  }).format(new Date(value))
}
function expiry(invitation: AdminInvitation) {
  const status = invitationStatus(invitation)
  if (status === 'accepted') return t('admin.invitations.acceptedOn', { date: formatDate(invitation.accepted_at || '') })
  if (status === 'revoked') return t('admin.invitations.revokedOn', { date: formatDate(invitation.updated_at) })
  if (status === 'expired') {
    const elapsedMinutes = Math.max(1, Math.floor((now.value - new Date(invitation.expires_at).getTime()) / 60_000))
    if (elapsedMinutes < 60) return t('admin.invitations.expiredMinutesAgo', { count: elapsedMinutes })
    const elapsedHours = Math.min(24, Math.floor(elapsedMinutes / 60))
    return t('admin.invitations.expiredHoursAgo', { count: elapsedHours })
  }
  const remaining = Math.max(0, new Date(invitation.expires_at).getTime() - now.value)
  const totalSeconds = Math.floor(remaining / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return t('admin.invitations.expiresIn', { hours, minutes, seconds })
}
</script>
<template>
  <div>
    <!-- Invitations are managed from the modal; the page stays compact. -->
    <UModal
      v-model:open="open"
      :title="issuedUrl ? t('admin.invitations.linkTitle') : resendTarget ? t('admin.invitations.reactivate') : t('admin.invitations.invite')"
      :description="
        issuedUrl ? t('admin.invitations.linkDescription') : resendTarget ? t('admin.invitations.reactivateDescription') : t('admin.invitations.modalDescription')
      "
      :ui="{ content: 'sm:max-w-lg' }"
    >
      <template #body>
        <div v-if="issuedUrl" class="space-y-4">
          <UFormField :label="t('admin.invitations.link')">
            <UInput :model-value="issuedUrl" readonly class="w-full font-mono text-xs" />
          </UFormField>
          <div class="flex flex-wrap gap-2">
            <UButton icon="i-lucide-copy" @click="copyLink">{{ t('admin.invitations.copy') }}</UButton>
            <UButton variant="outline" color="neutral" @click="open = false">{{ t('admin.invitations.close') }}</UButton>
          </div>
        </div>
        <UForm v-else :schema="schema" :state="form" class="space-y-4" @submit="create" @error="onFormError">
          <UFormField name="name" :label="t('admin.invitations.organizationName')" required>
            <UInput v-model="form.name" class="w-full" maxlength="120" />
          </UFormField>
          <UFormField name="slug" :label="t('admin.invitations.slug')" :hint="t('admin.invitations.slugHint')" required>
            <UInput v-model="form.slug" class="w-full" maxlength="80" @input="slugTouched = true" />
          </UFormField>
          <UFormField name="email" :label="t('admin.invitations.email')" required>
            <UInput v-model="form.email" type="email" class="w-full" maxlength="320" />
          </UFormField>
          <UFormField name="expires_minutes" :label="t('admin.invitations.expiresMinutes')" required>
            <UFieldGroup class="w-full">
              <UInput icon="i-lucide-calendar-clock" :model-value="`${expiryHours}h ${expiryMinutes}m`" readonly class="min-w-0 flex-1" />
              <USelect v-model="expiryHours" :items="hourOptions" aria-label="Hours" class="w-24" />
              <USelect v-model="expiryMinutes" :items="minuteOptions" aria-label="Minutes" class="w-24" />
            </UFieldGroup>
          </UFormField>
          <UButton type="submit" :loading="saving" :label="resendTarget ? t('admin.invitations.reactivate') : t('admin.invitations.create')" block />
        </UForm>
      </template>
    </UModal>

    <UModal v-model:open="deleteOpen" :title="t('admin.invitations.deleteTitle')" :description="t('admin.invitations.deleteConfirm')" :ui="{ content: 'sm:max-w-md' }">
      <template #body>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="outline" @click="deleteOpen = false">{{ t('admin.invitations.close') }}</UButton>
          <UButton color="error" icon="i-lucide-trash-2" :loading="deleting" :disabled="deleting" @click="confirmRemove">{{ t('admin.invitations.delete') }}</UButton>
        </div>
      </template>
    </UModal>
  </div>

  <UCard class="shrink-0" :ui="{ root: 'rounded-xl shadow-none ring-1 ring-default', header: 'border-b border-default p-4 sm:p-5', body: 'p-4 sm:p-5' }">
    <template #header>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_auto]">
        <UInput v-model="search" icon="i-lucide-search" :placeholder="t('admin.invitations.search')" />
        <USelect v-model="statusFilter" :items="statusOptions" />
        <UButton size="sm" icon="i-lucide-user-plus" class="h-9 whitespace-nowrap px-4" @click="openPanel">
          {{ t('admin.invitations.invite') }}
        </UButton>
      </div>
    </template>
    <div v-if="status === 'pending'" role="status" class="text-sm text-muted">
      {{ t('admin.invitations.loading') }}
    </div>
    <div v-else-if="!filteredInvitations.length" class="rounded-lg border border-dashed border-default px-4 py-10 text-center text-sm text-muted">
      {{ t('admin.invitations.empty') }}
    </div>
    <ul v-else class="space-y-2">
      <li
        v-for="invitation in filteredInvitations"
        :key="invitation.id"
        class="flex min-h-15 flex-wrap items-center justify-between gap-3 rounded-lg border border-default bg-default/20 px-3 py-3 transition-colors hover:bg-elevated/50 sm:px-4"
      >
        <div class="min-w-0">
          <p class="truncate text-sm font-medium text-highlighted">{{ invitation.organization_name }}</p>
          <p class="truncate text-xs text-muted">
            {{ invitation.email }} · {{ expiry(invitation) }}
          </p>
        </div>
        <div class="flex items-center gap-1.5">
          <UBadge :color="statusColors[invitationStatus(invitation)]" variant="subtle">{{
            t(`admin.invitations.status.${invitationStatus(invitation)}`)
          }}</UBadge>
          <UButton
            v-if="invitationStatus(invitation) === 'pending' || invitationStatus(invitation) === 'expired'"
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-lucide-refresh-cw"
            :loading="reactivatingId === invitation.id"
            :disabled="Boolean(reactivatingId)"
            :aria-label="t('admin.invitations.resend')"
            @click="resend(invitation)"
          />
          <UButton
            v-if="invitationStatus(invitation) !== 'pending'"
            size="xs"
            variant="ghost"
            color="error"
            icon="i-lucide-trash-2"
            :aria-label="t('admin.invitations.delete')"
            @click="remove(invitation)"
          />
          <UButton
            v-if="invitation.status === 'pending'"
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-lucide-x"
            :aria-label="t('admin.invitations.revoke')"
            @click="revoke(invitation)"
          />
        </div>
      </li>
    </ul>
  </UCard>

    <UModal
      v-if="false"
      v-model:open="open"
      :title="issuedUrl ? t('admin.invitations.linkTitle') : t('admin.invitations.invite')"
      :description="
        issuedUrl ? t('admin.invitations.linkDescription') : t('admin.invitations.modalDescription')
      "
      :ui="{ content: 'sm:max-w-lg' }"
    >
      <template #body>
        <!-- Once the link exists the form is done; what matters is copying it. -->
        <div v-if="issuedUrl" class="space-y-4">
          <UFormField :label="t('admin.invitations.link')">
            <UInput :model-value="issuedUrl" readonly class="w-full font-mono text-xs" />
          </UFormField>
          <div class="flex flex-wrap gap-2">
            <UButton icon="i-lucide-copy" @click="copyLink">{{
              t('admin.invitations.copy')
            }}</UButton>
            <UButton variant="outline" color="neutral" @click="open = false">{{
              t('admin.invitations.close')
            }}</UButton>
          </div>
        </div>

        <UForm
          v-else
          :schema="schema"
          :state="form"
          class="space-y-4"
          @submit="create"
          @error="onFormError"
        >
          <UFormField name="name" :label="t('admin.invitations.organizationName')" required>
            <UInput v-model="form.name" class="w-full" maxlength="120" />
          </UFormField>
          <UFormField
            name="slug"
            :label="t('admin.invitations.slug')"
            :hint="t('admin.invitations.slugHint')"
            required
          >
            <UInput
              v-model="form.slug"
              class="w-full"
              maxlength="80"
              @input="slugTouched = true"
            />
          </UFormField>
          <UFormField name="email" :label="t('admin.invitations.email')" required>
            <UInput v-model="form.email" type="email" class="w-full" maxlength="320" />
          </UFormField>
          <UFormField
            name="expires_minutes"
            :label="t('admin.invitations.expiresMinutes')"
            required
          >
            <UFieldGroup class="w-full">
              <UInput icon="i-lucide-calendar-clock" :model-value="`${expiryHours}h ${expiryMinutes}m`" readonly class="min-w-0 flex-1" />
              <USelect v-model="expiryHours" :items="hourOptions" aria-label="Hours" class="w-24" />
              <USelect v-model="expiryMinutes" :items="minuteOptions" aria-label="Minutes" class="w-24" />
            </UFieldGroup>
          </UFormField>
          <UButton
            type="submit"
            :loading="saving"
            :label="t('admin.invitations.create')"
            block
          />
        </UForm>
      </template>
    </UModal>
</template>
