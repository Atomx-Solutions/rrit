<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'workspace' })
const { data, base } = useWorkspace()
const { t } = useI18n()
const route = useRoute()
useSeoMeta({ title: () => `${t('nav.socialPosts')} · Framic` })
const page = ref(1)
const pageSize = ref(10)
const requestedChannel = route.query.channel
const channel = ref<'all' | 'Facebook' | 'Instagram' | 'TikTok'>(
  requestedChannel === 'TikTok' ? 'TikTok' : 'Facebook',
)
const search = ref('')
const query = computed(() => ({
  page: page.value,
  pageSize: pageSize.value,
  channel: channel.value,
  search: search.value,
}))
const {
  data: result,
  error: loadError,
  status,
  refresh,
} = await useFetch('/api/meta/posts', { lazy: true, key: 'social-posts', query })
const { data: connection } = await useFetch('/api/meta/status', { lazy: true, key: 'meta-status' })
const selected = ref<NonNullable<typeof result.value>['posts'][number] | null>(null)
const importing = ref(false)
const { data: tiktokStatus } = await useFetch('/api/tiktok/status', { lazy: true, key: 'tiktok-status' })
const { data: instagramStatus } = await useFetch('/api/instagram/status', { lazy: true, key: 'instagram-status' })
// Instagram imports from its own connection or from the account linked to the page.
const canImport = computed(() =>
  importChannel.value === 'TikTok'
    ? tiktokStatus.value?.connection?.status === 'connected'
    : connection.value?.connection?.status === 'connected' ||
      (importChannel.value === 'Instagram' && instagramStatus.value?.connection?.status === 'connected'),
)
const importChannel = ref<'Facebook' | 'Instagram' | 'TikTok'>(
  requestedChannel === 'TikTok' ? 'TikTok' : 'Facebook',
)
const cursor = ref<string | undefined>()
const hasMore = ref(false)
const message = ref('')
const error = ref('')
const { showError, showSuccess, watchError } = useFormFeedback()
watchError(error)
watch(loadError, (value) => {
  if (value) showError(t('social.loadError'))
}, { immediate: true })
watch([channel, search, pageSize], () => {
  page.value = 1
})
watch(importChannel, () => {
  cursor.value = undefined
  hasMore.value = false
  message.value = ''
  // Switch the visible results immediately; importing the selected channel
  // should not leave the previous platform highlighted while it loads.
  channel.value = importChannel.value
  page.value = 1
})
async function sync(more = false) {
  importing.value = true
  error.value = ''
  message.value = ''
  try {
    const isTikTok = importChannel.value === 'TikTok'
    const response = await $fetch<{ imported: number; nextCursor?: string | null }>(isTikTok ? '/api/tiktok/sync' : '/api/meta/sync', {
      method: 'POST',
      body: isTikTok
        ? { ...(more && cursor.value ? { cursor: cursor.value } : {}) }
        : { channel: importChannel.value, ...(more && cursor.value ? { after: cursor.value } : {}) },
      retry: 0,
    })
    cursor.value = response.nextCursor || undefined
    hasMore.value = !!cursor.value
    // Keep the imported channel and visible results in sync after refresh.
    channel.value = importChannel.value
    page.value = 1
    message.value = t('social.importedMessage', { count: response.imported, channel: importChannel.value })
    showSuccess(message.value)
    await refresh()
    await refreshNuxtData(isTikTok ? 'tiktok-status' : 'meta-status')
  } catch (problem) {
    const details = problem as { data?: { code?: string; message?: string; data?: { code?: string } } }
    const code = details.data?.code || details.data?.data?.code
    const msg = details.data?.message || ''
    error.value = code === 'PAGE_ALREADY_CONNECTED'
      ? t('social.pageAlreadyConnected')
      : msg.includes('SCOPE_MISSING') || msg.includes('TOKEN_EXPIRED')
        ? t('social.tiktokReconnectRequired')
        : t('social.importError')
  } finally {
    importing.value = false
  }
}
// Network and import source wait in a side panel, as on the posts list.
const filtersOpen = ref(false)
const networkFilters = computed(() => [
  { label: t('content.filterAll'), value: 'all' as const, icon: 'i-lucide-globe' },
  { label: 'Facebook', value: 'Facebook' as const, icon: 'i-lucide-facebook' },
  { label: 'Instagram', value: 'Instagram' as const, icon: 'i-lucide-instagram' },
  { label: 'TikTok', value: 'TikTok' as const, icon: undefined },
])
</script>
<template>
  <DashboardPage
    :title="t('nav.socialPosts')"
    :mobile-title="t('nav.posts')"
    :description="t('legacy.socialPostsDescription')"
    :toolbar-border="false"
  >
    <!-- One card per network: side by side where there is room, stacked on a phone. -->
    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <SocialConnections />
      <InstagramConnection />
      <TikTokConnection />
    </div>
    <!-- The same toolbar as the posts list: search on the left, the filters
         behind one button and the main action beside it. -->
    <div class="mt-6 flex items-center gap-2 border-t border-default pt-6 sm:gap-3">
      <UInput
        v-model="search"
        icon="i-lucide-search"
        :aria-label="t('social.searchImported')"
        :placeholder="t('social.searchText')"
        :maxlength="200"
        class="min-w-0 flex-1 sm:w-72 sm:flex-none"
      />
      <UButton
        variant="outline"
        icon="i-lucide-sliders-horizontal"
        class="shrink-0 sm:ml-auto"
        :aria-label="t('content.filters')"
        @click="filtersOpen = true"
      >
        <span class="hidden sm:inline">{{ t('content.filters') }}</span>
      </UButton>
      <UButton
        variant="outline"
        icon="i-lucide-refresh-cw"
        class="shrink-0"
        :loading="importing"
        :disabled="!canImport"
        :aria-label="t('social.refreshPosts')"
        @click="sync()"
      >
        <span class="hidden sm:inline">{{ t('social.refreshPosts') }}</span>
      </UButton>
    </div>
    <div v-if="hasMore" class="flex justify-end">
      <UButton variant="outline" color="neutral" size="sm" :loading="importing" @click="sync(true)">{{ t('social.loadOlder') }}</UButton>
    </div>
    <USlideover v-model:open="filtersOpen" :title="t('content.filters')" :ui="{ content: 'max-w-sm' }">
      <template #body>
        <div class="space-y-6">
          <fieldset class="space-y-2">
            <legend class="mb-2 text-sm font-semibold text-highlighted">{{ t('content.networkHeading') }}</legend>
            <div class="flex flex-wrap gap-2">
              <UButton
                v-for="item in networkFilters"
                :key="item.value"
                :icon="item.icon"
                size="sm"
                :color="channel === item.value ? 'primary' : 'neutral'"
                :variant="channel === item.value ? 'soft' : 'outline'"
                :aria-pressed="channel === item.value"
                @click="channel = item.value"
              >
                <TikTokMark v-if="item.value === 'TikTok'" class="size-4" />{{ item.label }}
              </UButton>
            </div>
          </fieldset>
          <fieldset class="space-y-2">
            <legend class="mb-2 text-sm font-semibold text-highlighted">{{ t('social.importFrom') }}</legend>
            <div class="flex flex-wrap gap-2">
              <UButton
                v-for="item in networkFilters.filter((entry) => entry.value !== 'all')"
                :key="item.value"
                :icon="item.icon"
                size="sm"
                :disabled="importing"
                :color="importChannel === item.value ? 'primary' : 'neutral'"
                :variant="importChannel === item.value ? 'soft' : 'outline'"
                :aria-pressed="importChannel === item.value"
                @click="importChannel = item.value"
              >
                <TikTokMark v-if="item.value === 'TikTok'" class="size-4" />{{ item.label }}
              </UButton>
            </div>
          </fieldset>
        </div>
      </template>
      <template #footer>
        <UButton class="w-full justify-center" @click="filtersOpen = false">{{ t('content.showResults', { count: result?.total ?? 0 }) }}</UButton>
      </template>
    </USlideover>
    <UCard
      v-if="result?.posts.length"
      :ui="{ body: 'p-0 sm:p-0' }"
      :aria-busy="status === 'pending'"
    >
      <div class="divide-y divide-default">
        <article v-for="post in result.posts" :key="post.id" class="flex items-center gap-4 p-4">
          <UButton
            variant="ghost"
            color="neutral"
            :padded="false"
            class="relative size-16 shrink-0 overflow-hidden rounded-md text-left transition hover:ring-2 hover:ring-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            :aria-label="`${t('common.view')} ${t('social.postIn')} ${post.channel}`"
            @click="selected = post"
          >
            <MediaImage :src="post.image || ''" alt="" class="size-16" />
            <span
              v-if="post.mediaType.toUpperCase().includes('VIDEO')"
              class="absolute inset-0 flex items-center justify-center bg-black/35 text-white"
              :aria-label="t('social.video')"
            >
              <UIcon name="i-lucide-play-circle" class="size-7 drop-shadow" />
            </span>
          </UButton>
          <div class="min-w-0 flex-1">
            <p class="text-xs text-muted">
              {{ post.channel }} ·
              {{
                new Intl.DateTimeFormat('sq', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  timeZone: data.preferences.timezone,
                }).format(new Date(post.publishedAt))
              }}
              <UBadge
                v-if="post.mediaType.toUpperCase().includes('VIDEO')"
                color="neutral"
                variant="subtle"
                size="xs"
                class="ms-1 align-middle"
              >
                <UIcon name="i-lucide-play" class="me-0.5 size-3" />
                {{ t('social.video') }}
              </UBadge>
            </p>
            <p class="text-sm line-clamp-2 mt-1">{{ post.caption || t('social.noCaption') }}</p>
          </div>
          <UButton
            variant="outline"
            color="neutral"
            :aria-label="`${t('common.view')} ${t('social.postIn')} ${post.channel}`"
            @click="selected = post"
            >{{ t('common.view') }}</UButton
          >
        </article>
      </div>
      <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="result.total" />
    </UCard>
    <DashboardEmpty
      v-else-if="status !== 'pending'"
      icon="i-lucide-images"
      :title="t('social.emptyTitle')"
      :description="t('social.emptyDescription')"
      :actions="[{ label: t('content.createPost'), to: base + '/monthly-planner', color: 'primary', icon: 'i-lucide-plus' }]"
    />
    <USlideover
      :open="!!selected"
      :title="t('social.postFromNetwork')"
      :description="t('social.postFromNetworkDescription')"
      @update:open="selected = $event ? selected : null"
    >
      <template #body
        ><div v-if="selected" class="space-y-5">
          <div v-if="selected.channel === 'TikTok' && selected.permalink" class="w-full">
            <iframe
              :key="selected.id"
              :src="`https://www.tiktok.com/player/v1/${selected.permalink.split('/video/')[1]?.split('?')[0]}?music_info=1&description=1`"
              class="w-full rounded-xl"
              style="height: 740px; border: none;"
              allow="fullscreen"
              sandbox="allow-scripts allow-same-origin allow-popups"
            />
          </div>
          <ChannelPreview
            v-if="!(selected.channel === 'TikTok' && selected.permalink)"
            :channel="selected.channel"
            :name="data.brand.name"
            :image="selected.image || ''"
            :caption="selected.caption"
            :video-url="selected.channel !== 'Facebook' && selected.mediaType.toUpperCase().includes('VIDEO') ? selected.image : null"
          /><UButton
            v-if="selected.permalink"
            :to="selected.permalink"
            target="_blank"
            rel="noopener noreferrer"
            variant="outline"
            color="neutral"
            icon="i-lucide-external-link"
            >{{ t('social.openIn') }} {{ selected.channel }}</UButton
          >
          <UAlert
            v-if="selected.channel === 'Facebook' && selected.mediaType.toUpperCase().includes('VIDEO')"
            color="warning"
            variant="subtle"
            icon="i-lucide-info"
            :title="t('social.facebookVideoUnavailableTitle')"
            :description="t('social.facebookVideoUnavailableDescription')"
          />
          <p
            v-if="selected.mediaType === 'VIDEO' || selected.mediaType === 'CAROUSEL_ALBUM'"
            class="text-sm text-muted"
          >
            {{ t('social.mediaDescription') }}
          </p>
        </div></template
      >
    </USlideover>
  </DashboardPage>
</template>
