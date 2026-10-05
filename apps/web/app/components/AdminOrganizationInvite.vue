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
  accepted_at: string | null
  created_at: string
}

const emit = defineEmits<{ created: [] }>()
const { t } = useI18n()
const { onFormError, showError, showSuccess } = useFormFeedback()

const open = ref(false)
const saving = ref(false)
// The link exists in one place only, for as long as this panel stays open.
// Nothing can recover it afterwards, so the panel does not close by itself.
const issuedUrl = ref('')

const empty = () => ({ name: '', slug: '', email: '', expires_days: 7 })
const form = reactive(empty())
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
  expires_days: z
    .number(t('admin.invitations.expiresInvalid'))
    .int(t('admin.invitations.expiresInvalid'))
    .min(1, t('admin.invitations.expiresInvalid'))
    .max(30, t('admin.invitations.expiresInvalid')),
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

function openPanel() {
  Object.assign(form, empty())
  slugTouched.value = false
  issuedUrl.value = ''
  open.value = true
}

function problem(error: unknown) {
  return (
    (error as { data?: { message?: string } })?.data?.message || t('admin.invitations.failed')
  )
}

async function create() {
  if (saving.value) return
  saving.value = true
  try {
    const result = await $fetch<{ url: string }>('/api/admin/invitations', {
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

async function resend(invitation: AdminInvitation) {
  try {
    const result = await $fetch<{ url: string }>(`/api/admin/invitations/${invitation.id}/resend`, {
      method: 'POST',
      body: { expires_days: 7 },
    })
    issuedUrl.value = result.url
    open.value = true
    await refresh()
  } catch (error) {
    showError(problem(error))
  }
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
  return invitation.status === 'accepted'
    ? t('admin.invitations.acceptedOn', { date: formatDate(invitation.accepted_at || '') })
    : t('admin.invitations.expiresOn', { date: formatDate(invitation.expires_at) })
}
</script>
<template>
  <UCard class="shrink-0" :ui="{ header: 'px-4 py-3 sm:px-4', body: 'p-4 sm:p-4' }">
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="min-w-0">
          <h2 class="text-sm font-semibold">{{ t('admin.invitations.title') }}</h2>
          <p class="text-xs text-muted">{{ t('admin.invitations.description') }}</p>
        </div>
        <UButton size="sm" icon="i-lucide-user-plus" @click="openPanel">{{
          t('admin.invitations.invite')
        }}</UButton>
      </div>
    </template>

    <div v-if="status === 'pending'" role="status" class="text-sm text-muted">
      {{ t('admin.invitations.loading') }}
    </div>
    <p v-else-if="!data.length" class="text-sm text-muted">{{ t('admin.invitations.empty') }}</p>
    <ul v-else class="space-y-2">
      <li
        v-for="invitation in data"
        :key="invitation.id"
        class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-default px-3 py-2.5"
      >
        <div class="min-w-0">
          <p class="truncate text-sm font-medium">{{ invitation.organization_name }}</p>
          <p class="truncate text-xs text-muted">
            {{ invitation.email }} · {{ expiry(invitation) }}
          </p>
        </div>
        <div class="flex items-center gap-1.5">
          <UBadge :color="statusColors[invitation.status]" variant="subtle">{{
            t(`admin.invitations.status.${invitation.status}`)
          }}</UBadge>
          <UButton
            v-if="invitation.status !== 'accepted'"
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-lucide-refresh-cw"
            :aria-label="t('admin.invitations.resend')"
            @click="resend(invitation)"
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

    <UModal
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
            name="expires_days"
            :label="t('admin.invitations.expiresDays')"
            :hint="t('admin.invitations.expiresHint')"
            required
          >
            <UInputNumber v-model="form.expires_days" :min="1" :max="30" class="w-full" />
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
  </UCard>
</template>
