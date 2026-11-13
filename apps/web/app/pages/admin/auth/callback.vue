<script setup lang="ts">
import { adminAuthClient } from '~/utils/auth-client'
import { takeAdminTarget } from '~/utils/admin-sign-in'

definePageMeta({ layout: false })
const { t } = useI18n()
useSeoMeta({ title: () => `${t('admin.login.title')} · Framic`, robots: 'noindex, nofollow' })

// Microsoft returns here with a one-time code. It becomes the admin session,
// and the server then decides whether that session may use the console.
onMounted(async () => {
  const exchanged = await adminAuthClient.exchangeCallbackCode()
  if (exchanged.error) {
    // The provider's wording (for example a wrong client secret in Supabase)
    // stays in this browser's console; it may quote part of the one-time code,
    // so it is never put in a URL.
    console.warn('Admin Microsoft sign-in failed:', exchanged.error.message)
    await navigateTo({ path: '/admin/login', query: { failed: '1' } }, { replace: true })
    return
  }
  try {
    await $fetch('/api/admin/me', { retry: 0 })
  } catch {
    // A company account without the role is not kept signed in here.
    await adminAuthClient.signOut()
    await navigateTo({ path: '/admin/login', query: { denied: '1' } }, { replace: true })
    return
  }
  useState<number>('superadmin-verified-at').value = Date.now()
  clearNuxtData('admin-me')
  await navigateTo(takeAdminTarget(), { replace: true })
})
</script>
<template>
  <UMain class="flex min-h-dvh flex-col items-center justify-center gap-4 bg-muted px-4 py-10">
    <BrandLogo />
    <div class="flex items-center gap-2 text-sm text-muted">
      <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
      {{ t('admin.login.completing') }}
    </div>
  </UMain>
</template>
