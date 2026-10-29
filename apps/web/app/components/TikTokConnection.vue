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
  <UCard :ui="{ root: 'h-full', body: 'p-4 sm:p-5 flex h-full flex-col gap-4' }">
    <div class="flex items-center gap-3">
      <UAvatar :ui="{ root: 'bg-inverted/10 text-highlighted rounded-xl' }">
        <template #default><TikTokMark class="size-5 text-highlighted" /></template>
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
    <p v-if="error" class="text-sm text-error">{{ error }}</p>
    <div class="mt-auto flex gap-2">
      <UButton
        type="button"
        :loading="busy"
        :disabled="!status?.configured"
        :color="status?.connection?.status === 'connected' ? 'neutral' : 'primary'"
        :variant="status?.connection?.status === 'connected' ? 'soft' : 'solid'"
        :icon="status?.connection?.status === 'connected' ? 'i-lucide-refresh-cw' : 'i-lucide-plug-zap'"
        size="sm"
        class="flex-1 justify-center"
        @click="connect"
      >{{ status?.connection?.status === 'connected' ? t('social.changeConnection') : t('tiktok.connect') }}</UButton>
      <UButton
        v-if="status?.connection?.status === 'connected'"
        type="button"
        color="error"
        variant="soft"
        icon="i-lucide-unplug"
        size="sm"
        class="flex-1 justify-center"
        @click="disconnecting = true"
      >{{ t('social.disconnect') }}</UButton>
    </div>
  </UCard>
    <UModal
      v-model:open="disconnecting"
      :dismissible="false"
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
</template>
