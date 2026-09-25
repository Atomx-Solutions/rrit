<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'
import { adminAuthClient } from '~/utils/auth-client'
import { safeRedirect } from '~~/shared/utils/format'

definePageMeta({ layout: false })
const { t } = useI18n()
const route = useRoute()
useSeoMeta({ title: () => `${t('admin.login.title')} · Rrit`, robots: 'noindex, nofollow' })

// Arriving here signed in without the superadmin role (from the page guard).
const error = ref(route.query.denied ? t('admin.login.denied') : '')
const loading = ref(false)
const { onFormError, watchError } = useFormFeedback()
watchError(error)

const schema = z.object({
  email: z.email(t('auth.validationEmail')),
  password: z.string().min(1, t('admin.login.passwordRequired')),
})
type Schema = z.output<typeof schema>

const fields = computed(() => [
  { name: 'email', type: 'email' as const, label: t('admin.login.email'), placeholder: 'emri@rrit.com', required: true, autocomplete: 'username' },
  { name: 'password', type: 'password' as const, label: t('admin.login.password'), required: true, autocomplete: 'current-password' },
])

async function onSubmit(event: FormSubmitEvent<Schema>) {
  loading.value = true
  error.value = ''
  try {
    const result = await adminAuthClient.signIn.email({
      email: event.data.email.trim(),
      password: event.data.password,
    })
    if (result.error) {
      error.value = t('admin.login.failed')
      return
    }
    try {
      await $fetch('/api/admin/me', { retry: 0 })
    } catch {
      // A valid customer account is not a platform owner: do not keep it signed in here.
      await adminAuthClient.signOut()
      error.value = t('admin.login.denied')
      return
    }
    clearNuxtData('admin-me')
    const target = safeRedirect(route.query.redirect, '/admin')
    await navigateTo(target.startsWith('/admin') ? target : '/admin', { replace: true })
  } finally {
    loading.value = false
  }
}
</script>
<template>
  <UMain class="flex min-h-dvh flex-col items-center justify-center gap-6 bg-muted px-4 py-10">
    <BrandLogo />
    <UCard class="w-full max-w-sm" :ui="{ body: 'p-6 sm:p-6' }">
      <UAuthForm
        :schema="schema"
        :fields="fields"
        :title="t('admin.login.title')"
        :description="t('admin.login.description')"
        icon="i-lucide-shield-check"
        :loading="loading"
        :submit="{ label: t('admin.login.submit'), block: true }"
        @submit="onSubmit"
        @error="onFormError"
      >
      </UAuthForm>
    </UCard>
    <UButton to="/" color="neutral" variant="link" size="sm" icon="i-lucide-arrow-left" :label="t('admin.login.back')" />
  </UMain>
</template>
