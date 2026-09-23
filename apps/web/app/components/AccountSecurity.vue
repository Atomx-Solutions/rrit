<script setup lang="ts">
import { z } from 'zod'
import { authClient } from '~/utils/auth-client'
const { t } = useI18n()
const toast = useToast()
const busy = ref(false)
const error = ref('')
const { onFormError, watchError } = useFormFeedback()
watchError(error)
const form = reactive({ currentPassword: '', newPassword: '', confirm: '' })
const schema = z
  .object({
    currentPassword: z.string().min(1, t('security.currentPasswordRequired')),
    newPassword: z.string().min(12, t('security.passwordTooShort')).max(128),
    confirm: z.string(),
  })
  .refine((value) => value.newPassword === value.confirm, {
    message: t('security.passwordMismatch'),
    path: ['confirm'],
  })
const {
  data: sessions,
  refresh,
  status,
} = await useAsyncData('account-sessions', async () => {
  const result = await authClient.listSessions()
  if (result.error) throw new Error(t('security.sessionReadError'))
  return result.data || []
})
const items = computed(() => sessions.value || [])
const { page, pageSize, total, paginated } = usePagination(items, 5)
async function changePassword() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const result = await authClient.changePassword({
      currentPassword: form.currentPassword,
      newPassword: form.newPassword,
      revokeOtherSessions: true,
    })
    if (result.error)
      error.value = t('security.passwordChangeError')
    else {
      Object.assign(form, { currentPassword: '', newPassword: '', confirm: '' })
      toast.add({ title: t('security.passwordChanged'), color: 'success' })
      await refresh()
    }
  } catch {
    error.value = t('auth.networkError')
  } finally {
    busy.value = false
  }
}
async function revokeOthers() {
  busy.value = true
  try {
    const result = await authClient.revokeOtherSessions()
    if (result.error) error.value = t('security.sessionsRevokeError')
    else {
      await refresh()
      toast.add({ title: t('security.sessionsRevoked'), color: 'success' })
    }
  } catch {
    error.value = t('auth.networkError')
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-base font-semibold">{{ t('legacy.accountSecurity') }}</h2>
      <p class="text-sm text-muted mt-2">
        {{ t('legacy.passwordDescription') }}
      </p>
    </div>
    <UForm
      :state="form"
      :schema="schema"
      class="space-y-5"
      @submit="changePassword"
      @error="onFormError"
    >
      <UFormField name="currentPassword" :label="t('security.currentPassword')" required
        ><UInput
          v-model="form.currentPassword"
          type="password"
          autocomplete="current-password"
          class="w-full"
          :disabled="busy"
      /></UFormField>
      <UFormField name="newPassword" :label="t('security.newPassword')" required
        ><UInput
          v-model="form.newPassword"
          type="password"
          autocomplete="new-password"
          class="w-full"
          :disabled="busy"
          maxlength="128"
      /></UFormField>
      <UFormField name="confirm" :label="t('security.confirmPassword')" required
        ><UInput
          v-model="form.confirm"
          type="password"
          autocomplete="new-password"
          class="w-full"
          :disabled="busy"
      /></UFormField>
      <UButton type="submit" variant="outline" :loading="busy" icon="i-lucide-key-round"
        >{{ t('legacy.changePassword') }}</UButton
      >
    </UForm>
    <USeparator />
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-sm font-semibold">{{ t('security.signedInDevices') }}</h2>
      <UButton variant="outline" color="neutral" :loading="busy" @click="revokeOthers"
        >{{ t('legacy.signOutOtherSessions') }}</UButton
      >
    </div>
    <USkeleton v-if="status === 'pending'" class="h-20 w-full" />
    <UAlert
      v-else-if="status === 'error'"
      color="warning"
      variant="outline"
      :title="t('security.sessionsLoadError')"
      :actions="[{ label: t('common.retry'), onClick: () => refresh() }]"
    />
    <UCard v-else :ui="{ body: 'p-0 sm:p-0' }"
      ><ul class="divide-y divide-default">
        <li v-for="session in paginated" :key="session.id" class="p-4 flex gap-3">
          <UIcon name="i-lucide-monitor-smartphone" class="size-5 shrink-0 text-muted mt-0.5" />
          <div class="min-w-0">
            <p class="text-sm break-words line-clamp-2">
              {{ session.userAgent || t('workspace.currentDevice') }}
            </p>
            <p class="text-xs text-muted mt-2">
              {{ t('security.signedInAt') }}:
              {{
                new Intl.DateTimeFormat('sq-AL', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  hourCycle: 'h23',
                }).format(new Date(session.createdAt))
              }}
            </p>
          </div>
        </li>
      </ul>
      <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total"
    /></UCard>
  </div>
</template>
