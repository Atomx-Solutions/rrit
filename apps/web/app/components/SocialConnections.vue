<script setup lang="ts">
defineProps<{ compact?: boolean }>()
const route = useRoute()
const { initLive } = useWorkspace()
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
    error.value = 'Faqet nuk u ngarkuan. Provo sërish ose rilidh llogarinë.'
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
      (problem as { data?: { message?: string } }).data?.message ||
      'Autorizimi nuk filloi. Provo sërish.'
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
    error.value = (problem as { data?: { message?: string } }).data?.message || 'Faqja nuk u lidh.'
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
    await initLive()
    await refreshNuxtData('social-posts')
  } catch (problem) {
    error.value =
      (problem as { data?: { message?: string } }).data?.message || 'Shkëputja nuk u përfundua.'
  } finally {
    busy.value = false
  }
}
onMounted(async () => {
  if (route.query.meta === 'select' || status.value?.connection?.status === 'pending')
    await loadPages()
  if (route.query.meta === 'failed')
    error.value = 'Autorizimi nuk u konfirmua. Provo sërish dhe lejo qasjen te faqja e biznesit.'
  if (route.query.meta === 'cancelled')
    error.value = 'Lidhja u anulua. Mund ta provosh përsëri kur të jesh gati.'
})
</script>
<template>
  <div class="space-y-4">
    <UAlert
      v-if="statusError || error"
      color="error"
      variant="outline"
      :title="error || 'Gjendja e lidhjes nuk u ngarkua.'"
      :actions="
        statusError ? [{ label: 'Provo sërish', onClick: () => refresh(), variant: 'outline' }] : []
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
                      'Nuk u gjet profil profesional i lidhur'
                  : status?.connection?.status === 'expired'
                    ? 'Lidhja duhet rinovuar'
                    : 'Ende e palidhur'
              }}
            </p>
          </div>
          <UBadge
            v-if="connected && (channel === 'Facebook' || status?.connection?.instagramId)"
            variant="outline"
            color="success"
            >Lidhur</UBadge
          >
        </div>
      </UCard>
    </div>
    <p v-if="!status?.configured && !statusError" class="text-sm text-muted">
      Lidhja me Meta është në përgatitje nga platforma. Mund ta plotësosh profilin dhe t’i
      përgatitësh postimet tani.
    </p>
    <p v-else-if="!connected" class="text-sm text-muted">
      Hyr përmes Meta dhe zgjidh faqen e biznesit. Instagram-i duhet të jetë profil profesional i
      lidhur me atë faqe.
    </p>
    <div class="flex flex-wrap gap-2">
      <UButton
        :loading="busy"
        :disabled="!status?.configured"
        color="neutral"
        variant="outline"
        icon="i-lucide-link"
        @click="connect"
        >{{ connected ? 'Ndrysho ose rinovo lidhjen' : 'Lidh përmes Meta' }}</UButton
      >
      <UButton
        v-if="status?.connection?.status === 'pending'"
        :loading="busy"
        variant="outline"
        color="neutral"
        @click="loadPages()"
        >Zgjidh faqen</UButton
      >
      <UButton v-if="connected" color="neutral" variant="ghost" @click="disconnecting = true"
        >Shkëput</UButton
      >
    </div>
    <UModal
      v-model:open="selecting"
      title="Zgjidh biznesin tënd"
      description="Shfaqen vetëm faqet ku Meta konfirmon qasjen tënde."
    >
      <template #body
        ><div class="space-y-4">
          <UAlert v-if="error" color="error" variant="outline" :title="error" />
          <DashboardEmpty
            v-if="!pages.length && !busy"
            title="Nuk u gjet asnjë faqe"
            description="Kontrollo në Meta që ke qasje në faqen e biznesit dhe që ia ke lejuar Rrit-it."
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
                    : 'Pa profil Instagram të lidhur'
                }}
              </p>
              <p v-if="!page.canCreate" class="text-xs text-warning mt-1">
                Mungon leja për krijimin e postimeve.
              </p>
            </div>
            <UButton
              variant="outline"
              color="neutral"
              :loading="busy"
              :disabled="!page.canCreate"
              @click="select(page.id)"
              >Zgjidh</UButton
            >
          </div>
          <div class="flex justify-between">
            <UButton
              variant="outline"
              color="neutral"
              :disabled="busy || cursorIndex === 0"
              @click="changePage(-1)"
              >Mbrapa</UButton
            ><UButton
              variant="outline"
              color="neutral"
              :disabled="busy || !cursor"
              @click="changePage(1)"
              >Tjetër</UButton
            >
          </div>
        </div></template
      >
    </UModal>
    <UModal
      v-model:open="disconnecting"
      title="Shkëpute lidhjen me Meta?"
      description="Autorizimi i ruajtur dhe postimet e importuara hiqen nga Rrit. Publikimet automatike në pritje anulohen; oraret mbeten në kalendar. Publikimet që presin verifikim vazhdojnë të shënohen si të tilla."
    >
      <template #body
        ><div class="flex gap-3">
          <UButton variant="outline" color="error" :loading="busy" @click="disconnect"
            >Shkëput lidhjen</UButton
          ><UButton variant="outline" color="neutral" @click="disconnecting = false">Anulo</UButton>
        </div></template
      >
    </UModal>
  </div>
</template>
