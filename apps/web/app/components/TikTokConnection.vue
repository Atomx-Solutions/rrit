<script setup lang="ts">
const route = useRoute()
const { t } = useI18n()
const { data: status, refresh } = await useFetch('/api/tiktok/status', { key: 'tiktok-status' })
const busy = ref(false)
const error = ref('')
const disconnecting = ref(false)
async function connect() {
  busy.value = true; error.value = ''
  try {
    const result = await $fetch('/api/tiktok/start', { method: 'POST', body: { onboarding: route.path === '/onboarding' }, retry: 0 })
    await navigateTo(result.url, { external: true })
  } catch { error.value = t('tiktok.connectFailed') } finally { busy.value = false }
}
async function disconnect() {
  busy.value = true; error.value = ''
  try {
    await $fetch('/api/tiktok/disconnect', { method: 'POST', body: {}, retry: 0 })
    disconnecting.value = false
    await refresh()
  } catch { error.value = t('tiktok.disconnectFailed') } finally { busy.value = false }
}
</script>
<template>
  <UCard :ui="{ body: 'p-4 sm:p-5' }">
    <div class="flex items-center gap-3">
      <UAvatar :ui="{ root: 'bg-elevated text-default rounded-xl' }">
        <template #default><TikTokMark class="size-4" /></template>
      </UAvatar>
      <div class="min-w-0 flex-1">
        <h3 class="font-semibold text-sm">TikTok</h3>
        <p class="text-xs text-muted mt-1 truncate">
          {{
            status?.connection?.status === 'connected'
              ? status.connection.displayName || t('tiktok.connected')
              : t('tiktok.notConnected')
          }}
        </p>
      </div>
      <UBadge
        v-if="status?.connection?.status === 'connected'"
        variant="outline"
        color="success"
      >{{ t('tiktok.connected') }}</UBadge>
    </div>
    <div class="flex flex-wrap gap-2 mt-4">
      <UButton
        v-if="status?.connection?.status !== 'connected'"
        type="button"
        :loading="busy"
        :disabled="!status?.configured"
        color="neutral"
        variant="outline"
        icon="i-lucide-link"
        @click="connect"
      >{{ t('tiktok.connect') }}</UButton>
      <UButton
        v-if="status?.connection?.status === 'connected'"
        type="button"
        color="neutral"
        variant="ghost"
        @click="disconnecting = true"
      >{{ t('tiktok.disconnect') }}</UButton>
    </div>
    <p v-if="error" class="mt-3 text-sm text-error">{{ error }}</p>
    <UModal
      v-model:open="disconnecting"
      :title="t('tiktok.disconnectTitle')"
      :description="t('tiktok.disconnectDescription')"
    >
      <template #body>
        <div class="flex gap-3">
          <UButton type="button" variant="outline" color="error" :loading="busy" @click="disconnect">{{ t('tiktok.disconnectConfirm') }}</UButton>
          <UButton type="button" variant="outline" color="neutral" @click="disconnecting = false">{{ t('common.cancel') }}</UButton>
        </div>
      </template>
    </UModal>
  </UCard>
</template>
