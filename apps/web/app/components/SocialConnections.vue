<script setup lang="ts">
defineProps<{ compact?: boolean }>()
const route = useRoute()
const { t } = useI18n()
const { initBootstrap, loadPosts } = useWorkspace()
const {
  data: status,
  error: statusError,
  refresh,
} = await useFetch('/api/meta/status', { key: 'meta-status' })
const busy = ref(false)
const error = ref('')
const selecting = ref(false)
const disconnecting = ref(false)
const pages = ref<
  {
    id: string
    name: string
    instagram: { id: string; username?: string } | null
    canCreate: boolean
  }[]
>([])
const cursor = ref<string | null>(null)
const cursorHistory = ref<(string | undefined)[]>([undefined])
const cursorIndex = ref(0)
const connected = computed(() => status.value?.connection?.status === 'connected')
async function loadPages(after?: string) {
  busy.value = true
  error.value = ''
  try {
    const result = await $fetch('/api/meta/pages', { query: after ? { after } : {} })
    pages.value = result.pages
    cursor.value = result.nextCursor
    selecting.value = true
  } catch {
    error.value = t('social.pagesLoadError')
  } finally {
    busy.value = false
  }
}
async function changePage(direction: number) {
  if (direction > 0 && cursor.value) cursorHistory.value[++cursorIndex.value] = cursor.value
  else if (direction < 0 && cursorIndex.value > 0) cursorIndex.value--
  await loadPages(cursorHistory.value[cursorIndex.value])
}
async function connect() {
  busy.value = true
  error.value = ''
  try {
    const result = await $fetch('/api/meta/start', {
      method: 'POST',
      body: { onboarding: route.path === '/onboarding' },
      retry: 0,
    })
    await navigateTo(result.url, { external: true })
  } catch (problem) {
    error.value =
      (problem as { data?: { message?: string } }).data?.message || t('social.connectError')
  } finally {
    busy.value = false
  }
}
async function select(pageId: string) {
  busy.value = true
  error.value = ''
  try {
    await $fetch('/api/meta/select', { method: 'POST', body: { pageId }, retry: 0 })
    selecting.value = false
    await refresh()
    await refreshNuxtData('trial')
  } catch (problem) {
    error.value = (problem as { data?: { message?: string } }).data?.message || t('social.pageSelectError')
  } finally {
    busy.value = false
  }
}
async function disconnect() {
  busy.value = true
  error.value = ''
  try {
    await $fetch('/api/meta/disconnect', { method: 'POST', body: {}, retry: 0 })
    disconnecting.value = false
    await refresh()
    await initBootstrap()
    await loadPosts({ page: 1, pageSize: 50, status: 'scheduled' })
    await refreshNuxtData('social-posts')
  } catch (problem) {
    error.value =
      (problem as { data?: { message?: string } }).data?.message || t('social.disconnectError')
  } finally {
    busy.value = false
  }
}
onMounted(async () => {
  if (route.query.meta === 'select' || status.value?.connection?.status === 'pending')
    await loadPages()
  if (route.query.meta === 'failed')
    error.value = t('social.authorizationFailed')
  if (route.query.meta === 'cancelled')
    error.value = t('social.connectionCancelled')
})
</script>
<template>
  <div class="space-y-4">
    <UAlert
      v-if="statusError || error"
      color="error"
      variant="outline"
      :title="error || t('social.statusLoadError')"
      :actions="
        statusError ? [{ label: t('common.tryAgain'), onClick: () => refresh(), variant: 'outline' }] : []
      "
    />
    <div :class="compact ? 'space-y-3' : 'grid sm:grid-cols-2 gap-4'">
      <UCard
        v-for="channel in ['Facebook', 'Instagram']"
        :key="channel"
        :ui="{ body: 'p-4 sm:p-5' }"
      >
        <div class="flex items-center gap-3">
          <UAvatar
            :icon="channel === 'Facebook' ? 'i-lucide-facebook' : 'i-lucide-instagram'"
            :ui="{ root: 'bg-elevated text-default rounded-xl' }"
          />
          <div class="min-w-0 flex-1">
            <h3 class="font-semibold text-sm">{{ channel }}</h3>
            <p class="text-xs text-muted mt-1 truncate">
              {{
                connected
                  ? channel === 'Facebook'
                    ? status?.connection?.pageName
                    : status?.connection?.instagramUsername ||
                      t('social.noProfessionalProfile')
                  : status?.connection?.status === 'expired'
                    ? t('social.connectionExpired')
                    : t('social.notConnected')
              }}
            </p>
          </div>
          <UBadge
            v-if="connected && (channel === 'Facebook' || status?.connection?.instagramId)"
            variant="outline"
            color="success"
            >{{ t('social.connected') }}</UBadge
          >
        </div>
      </UCard>
    </div>
    <p v-if="!status?.configured && !statusError" class="text-sm text-muted">
      {{ t('social.preparing') }}
    </p>
    <p v-else-if="!connected" class="text-sm text-muted">
      {{ t('social.connectInstruction') }}
    </p>
    <div class="flex flex-wrap gap-2">
      <UButton
        :loading="busy"
        :disabled="!status?.configured"
        color="neutral"
        variant="outline"
        icon="i-lucide-link"
        @click="connect"
        >{{ connected ? t('social.changeConnection') : t('social.connectMeta') }}</UButton
      >
      <UButton
        v-if="status?.connection?.status === 'pending'"
        :loading="busy"
        variant="outline"
        color="neutral"
        @click="loadPages()"
        >{{ t('social.choosePage') }}</UButton
      >
      <UButton v-if="connected" color="neutral" variant="ghost" @click="disconnecting = true"
        >{{ t('social.disconnect') }}</UButton
      >
    </div>
    <UModal
      v-model:open="selecting"
      :title="t('social.chooseBusiness')"
      :description="t('social.chooseBusinessDescription')"
    >
      <template #body
        ><div class="space-y-4">
          <UAlert v-if="error" color="error" variant="outline" :title="error" />
          <DashboardEmpty
            v-if="!pages.length && !busy"
            :title="t('social.noPages')"
            :description="t('social.noPagesDescription')"
          />
          <div
            v-for="page in pages"
            :key="page.id"
            class="flex items-center gap-3 border-b border-default pb-4"
          >
            <div class="min-w-0 flex-1">
              <p class="font-medium text-sm">{{ page.name }}</p>
              <p class="text-xs text-muted mt-1">
                {{
                  page.instagram?.username
                    ? '@' + page.instagram.username
                    : t('social.noInstagram')
                }}
              </p>
              <p v-if="!page.canCreate" class="text-xs text-warning mt-1">
                {{ t('social.missingCreatePermission') }}
              </p>
            </div>
            <UButton
              variant="outline"
              color="neutral"
              :loading="busy"
              :disabled="!page.canCreate"
              @click="select(page.id)"
              >{{ t('social.choose') }}</UButton
            >
          </div>
          <div class="flex justify-between">
            <UButton
              variant="outline"
              color="neutral"
              :disabled="busy || cursorIndex === 0"
              @click="changePage(-1)"
              >{{ t('common.back') }}</UButton
            ><UButton
              variant="outline"
              color="neutral"
              :disabled="busy || !cursor"
              @click="changePage(1)"
              >{{ t('common.next') }}</UButton
            >
          </div>
        </div></template
      >
    </UModal>
    <UModal
      v-model:open="disconnecting"
      :title="t('social.disconnectTitle')"
      :description="t('social.disconnectDescription')"
    >
      <template #body
        ><div class="flex gap-3">
          <UButton variant="outline" color="error" :loading="busy" @click="disconnect"
            >{{ t('social.disconnectConfirm') }}</UButton
          ><UButton variant="outline" color="neutral" @click="disconnecting = false">{{ t('common.cancel') }}</UButton>
        </div></template
      >
    </UModal>
  </div>
</template>
