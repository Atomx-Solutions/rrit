<script setup lang="ts">
const route = useRoute()
const { t } = useI18n()
const { data: status, refresh } = await useFetch('/api/instagram/status', { key: 'instagram-status' })
// The account linked to the Facebook page is used when none is connected directly.
const { data: meta } = await useFetch('/api/meta/status', { key: 'meta-status' })
const busy = ref(false)
const error = ref('')
const disconnecting = ref(false)
const connected = computed(() => status.value?.connection?.status === 'connected')
const pageUsername = computed(() =>
  meta.value?.connection?.status === 'connected' ? meta.value.connection.instagramUsername : null,
)
const summary = computed(() => {
  if (connected.value) return `@${status.value!.connection!.username || status.value!.connection!.instagramId}`
  if (status.value?.connection?.status === 'expired') return t('social.connectionExpired')
  if (pageUsername.value) return t('instagram.viaPage', { username: pageUsername.value })
  return t('instagram.notConnected')
})
async function connect() {
  busy.value = true
  error.value = ''
  try {
    const result = await $fetch('/api/instagram/start', {
      method: 'POST',
      body: { onboarding: route.path === '/onboarding' },
      retry: 0,
    })
    await navigateTo(result.url, { external: true })
  } catch {
    error.value = t('instagram.connectFailed')
  } finally {
    busy.value = false
  }
}
async function disconnect() {
  busy.value = true
  error.value = ''
  try {
    await $fetch('/api/instagram/disconnect', { method: 'POST', body: {}, retry: 0 })
    disconnecting.value = false
    await refresh()
    await refreshNuxtData('social-posts')
  } catch {
    error.value = t('instagram.disconnectFailed')
  } finally {
    busy.value = false
  }
}
onMounted(() => {
  const outcome = route.query.instagram
  if (outcome === 'failed') error.value = t('instagram.authorizationFailed')
  if (outcome === 'cancelled') error.value = t('social.connectionCancelled')
  if (outcome === 'permissions') error.value = t('instagram.permissionsMissing')
  if (outcome === 'taken') error.value = t('instagram.alreadyConnected')
})
</script>
<template>
  <UCard :ui="{ root: 'h-full', body: 'p-4 sm:p-5 flex h-full flex-col gap-4' }">
    <div class="flex items-center gap-3">
      <UAvatar icon="i-lucide-instagram" :ui="{ root: 'bg-pink-500/10 text-pink-500 rounded-xl', icon: 'size-5' }" />
      <div class="min-w-0 flex-1">
        <h3 class="font-semibold text-sm">Instagram</h3>
        <p class="text-xs text-muted mt-1 truncate">{{ summary }}</p>
      </div>
      <UBadge v-if="connected || pageUsername" variant="outline" color="success">{{
        t('social.connected')
      }}</UBadge>
    </div>
    <p v-if="!status?.configured" class="text-sm text-muted">{{ t('instagram.notConfigured') }}</p>
    <p v-if="error" class="text-sm text-error">{{ error }}</p>
    <div class="mt-auto flex gap-2">
      <UButton
        type="button"
        :loading="busy"
        :disabled="!status?.configured"
        :color="connected ? 'neutral' : 'primary'"
        :variant="connected ? 'soft' : 'solid'"
        :icon="connected ? 'i-lucide-refresh-cw' : 'i-lucide-plug-zap'"
        size="sm"
        class="flex-1 justify-center"
        @click="connect"
        >{{ connected ? t('social.changeConnection') : t('instagram.connect') }}</UButton
      >
      <UButton
        v-if="status?.connection"
        type="button"
        color="error"
        variant="soft"
        icon="i-lucide-unplug"
        size="sm"
        class="flex-1 justify-center"
        @click="disconnecting = true"
        >{{ t('social.disconnect') }}</UButton
      >
    </div>
  </UCard>
  <UModal
    v-model:open="disconnecting"
    :dismissible="false"
    :title="t('instagram.disconnectTitle')"
    :description="t('instagram.disconnectDescription')"
  >
    <template #body>
      <div class="flex gap-3">
        <UButton type="button" variant="outline" color="error" :loading="busy" @click="disconnect">{{
          t('social.disconnectConfirm')
        }}</UButton>
        <UButton type="button" variant="outline" color="neutral" @click="disconnecting = false">{{
          t('common.cancel')
        }}</UButton>
      </div>
    </template>
  </UModal>
</template>
