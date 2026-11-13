<script setup lang="ts">
import { adminAuthClient } from '~/utils/auth-client'
import { rememberAdminTarget } from '~/utils/admin-sign-in'

definePageMeta({ layout: false })
const { t } = useI18n()
const route = useRoute()
useSeoMeta({ title: () => `${t('admin.login.title')} · Framic`, robots: 'noindex, nofollow' })

// Arriving here signed in without admin access (from the page guard or the
// sign-in callback), or back from a Microsoft sign-in that did not complete.
const error = ref(route.query.denied ? t('admin.login.denied') : route.query.failed ? t('admin.login.failed') : '')
const loading = ref(false)

// The company Microsoft account is the console's only sign-in; the server
// refuses admin requests from any other kind of session.
async function signIn() {
  loading.value = true
  error.value = ''
  rememberAdminTarget(route.query.redirect)
  const result = await adminAuthClient.signIn.microsoft({ callbackURL: '/admin/auth/callback' })
  // On success the browser is already on its way to Microsoft.
  if (result.error) {
    error.value = t('admin.login.failed')
    loading.value = false
  }
}
</script>
<template>
  <UMain class="flex min-h-dvh flex-col items-center justify-center gap-6 bg-muted px-4 py-10">
    <BrandLogo />
    <UCard class="w-full max-w-sm" :ui="{ body: 'p-6 sm:p-6' }">
      <div class="flex flex-col items-center gap-4 text-center">
        <UIcon name="i-lucide-shield-check" class="size-8 text-primary" />
        <div class="space-y-1">
          <h1 class="text-xl font-semibold text-highlighted">{{ t('admin.login.title') }}</h1>
          <p class="text-sm text-muted">{{ t('admin.login.description') }}</p>
        </div>
        <UAlert v-if="error" color="error" variant="subtle" :description="error" class="text-start" />
        <UButton
          block
          size="lg"
          icon="i-simple-icons-microsoft"
          :label="t('admin.login.submit')"
          :loading="loading"
          @click="signIn"
        />
      </div>
    </UCard>
    <UButton to="/" color="neutral" variant="link" size="sm" icon="i-lucide-arrow-left" :label="t('admin.login.back')" />
  </UMain>
</template>
