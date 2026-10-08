<script setup lang="ts">
import { z } from 'zod'
import { authClient } from '~/utils/auth-client'
import { hasPasswordSymbol, PASSWORD_MIN_LENGTH } from '~/utils/password-policy'

const props = defineProps<{
  organizationName: string
  email: string
  contactName?: string
  token: string
}>()
const emit = defineEmits<{ created: [] }>()

const { t } = useI18n()
const { onFormError, showError } = useFormFeedback()
const open = ref(true)
const busy = ref(false)
const showPassword = ref(false)
const form = reactive({ name: props.contactName || '', password: '', confirm: '' })

// The invitation already fixed the address, so the client only chooses a name
// and a password. Every rule carries its own message, or zod answers in English.
const schema = z
  .object({
    name: z.string().trim().min(2, t('auth.validationName')).max(100),
    password: z
      .string()
      .min(PASSWORD_MIN_LENGTH, t('auth.validationPassword'))
      .max(128, t('auth.validationPassword'))
      .refine(hasPasswordSymbol, t('auth.validationPasswordSymbol')),
    confirm: z.string(),
  })
  .refine((value) => value.password === value.confirm, {
    message: t('auth.validationPasswordMatch'),
    path: ['confirm'],
  })

// The account is created on the server with the address already confirmed,
// because the superadmin vouched for it when issuing the invitation. The client
// is signed in with the same password and the invitation is claimed at once, so
// no verification email stands between the link and the workspace.
async function submit() {
  if (busy.value) return
  busy.value = true
  try {
    await $fetch('/api/invitations/register', {
      method: 'POST',
      body: { token: props.token, name: form.name.trim(), password: form.password },
    })
    const signedIn = await authClient.signIn.email({
      email: props.email,
      password: form.password,
    })
    form.password = ''
    form.confirm = ''
    if (signedIn.error) {
      showError(signedIn.error.message || t('join.passwordFailed'))
      return
    }
    emit('created')
  } catch (error) {
    const problem = error as { data?: { message?: string }; message?: string }
    showError(t(problem.data?.message || problem.message || 'join.passwordFailed'))
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <UModal
    v-model:open="open"
    :dismissible="false"
    :close="false"
    :title="t('join.passwordTitle')"
    :description="t('join.passwordDescription', { organization: props.organizationName })"
    :ui="{ content: 'sm:max-w-md' }"
  >
    <template #body>
      <UForm :schema="schema" :state="form" class="space-y-4" @submit="submit" @error="onFormError">
        <UFormField :label="t('common.email')">
          <UInput :model-value="props.email" disabled class="w-full" />
        </UFormField>
        <UFormField name="name" :label="t('common.name')" required>
          <UInput v-model="form.name" class="w-full" maxlength="100" autocomplete="name" />
        </UFormField>
        <UFormField
          name="password"
          :label="t('legacy.password')"
          :description="t('auth.passwordHint')"
          required
        >
          <UInput
            v-model="form.password"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="new-password"
            maxlength="128"
            class="w-full"
            :ui="{ trailing: 'pe-1' }"
          >
            <template #trailing>
              <UButton
                color="neutral"
                variant="link"
                size="sm"
                :icon="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                :aria-label="t(showPassword ? 'auth.hidePassword' : 'auth.showPassword')"
                @click="showPassword = !showPassword"
              />
            </template>
          </UInput>
        </UFormField>
        <UFormField name="confirm" :label="t('auth.confirmPassword')" required>
          <UInput
            v-model="form.confirm"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="new-password"
            maxlength="128"
            class="w-full"
          />
        </UFormField>
        <UButton type="submit" :loading="busy" :label="t('join.passwordSubmit')" block />
      </UForm>
    </template>
  </UModal>
</template>
