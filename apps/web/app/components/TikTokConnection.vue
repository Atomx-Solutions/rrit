<script setup lang="ts">
const route = useRoute()
const { t } = useI18n()
const { data: status, refresh } = await useFetch('/api/tiktok/status', { key: 'tiktok-status' })
const busy = ref(false)
const file = ref<File | null>(null)
const message = ref('')
const error = ref('')
async function connect() {
  busy.value = true; error.value = ''
  try { const result = await $fetch('/api/tiktok/start', { method: 'POST', body: { onboarding: route.path === '/onboarding' }, retry: 0 }); await navigateTo(result.url, { external: true }) } catch { error.value = t('tiktok.connectFailed') } finally { busy.value = false }
}
async function upload() {
  if (!file.value) return
  busy.value = true; error.value = ''; message.value = ''
  try { const body = new FormData(); body.append('video', file.value); await $fetch('/api/tiktok/upload', { method: 'POST', body, retry: 0 }); message.value = t('tiktok.uploadSucceeded') } catch { error.value = t('tiktok.uploadFailed') } finally { busy.value = false }
}
async function disconnect() {
  busy.value = true; error.value = ''
  try { await $fetch('/api/tiktok/disconnect', { method: 'POST', body: {}, retry: 0 }); await refresh() } catch { error.value = t('tiktok.disconnectFailed') } finally { busy.value = false }
}
</script>
<template>
  <UCard :ui="{ body: 'p-4 sm:p-5' }">
    <div class="flex flex-wrap items-start justify-between gap-4"><div><div class="flex items-center gap-2"><TikTokMark class="size-5" /><h3 class="font-semibold">TikTok</h3></div><p class="mt-1 text-sm text-muted">{{ t('tiktok.description') }}</p></div><UBadge :color="status?.connection?.status === 'connected' ? 'success' : 'neutral'" variant="outline">{{ status?.connection?.status === 'connected' ? t('tiktok.connected') : t('tiktok.notConnected') }}</UBadge></div>
    <p v-if="!status?.configured" class="mt-4 text-sm text-muted">{{ t('tiktok.notConfigured') }}</p>
    <div v-else class="mt-4 flex flex-wrap items-center gap-3"><UButton v-if="status?.connection?.status !== 'connected'" :loading="busy" icon="i-lucide-link" color="neutral" variant="outline" @click="connect">{{ t('tiktok.connect') }}</UButton><template v-else><UInput type="file" accept="video/mp4,video/quicktime" :disabled="busy" @change="(event) => { file = (event.target as HTMLInputElement).files?.[0] || null }" /><UButton :loading="busy" :disabled="!file" icon="i-lucide-upload" @click="upload">{{ t('tiktok.send') }}</UButton><UButton :loading="busy" color="neutral" variant="ghost" @click="disconnect">{{ t('tiktok.disconnect') }}</UButton></template></div>
    <p v-if="message" class="mt-3 text-sm text-success">{{ message }}</p><p v-if="error" class="mt-3 text-sm text-error">{{ error }}</p>
  </UCard>
</template>
