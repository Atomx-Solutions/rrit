<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'workspace' })
const { data, base } = useWorkspace()
const { t } = useI18n()
useSeoMeta({ title: () => `${t('nav.socialPosts')} · Rrit` })
const page = ref(1)
const pageSize = ref(10)
const channel = ref<'all' | 'Facebook' | 'Instagram'>('Facebook')
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
} = await useFetch('/api/meta/posts', { key: 'social-posts', query })
const { data: connection } = await useFetch('/api/meta/status', { key: 'meta-status' })
const selected = ref<NonNullable<typeof result.value>['posts'][number] | null>(null)
const importing = ref(false)
const importChannel = ref<'Facebook' | 'Instagram'>('Facebook')
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
})
async function sync(more = false) {
  importing.value = true
  error.value = ''
  message.value = ''
  try {
    const response = await $fetch('/api/meta/sync', {
      method: 'POST',
      body: {
        channel: importChannel.value,
        ...(more && cursor.value ? { after: cursor.value } : {}),
      },
      retry: 0,
    })
    cursor.value = response.nextCursor || undefined
    hasMore.value = !!cursor.value
    message.value = t('social.importedMessage', { count: response.imported, channel: importChannel.value })
    showSuccess(message.value)
    await refresh()
    await refreshNuxtData('meta-status')
  } catch (problem) {
    const details = problem as { data?: { code?: string; message?: string; data?: { code?: string } } }
    const code = details.data?.code || details.data?.data?.code
    error.value = code === 'PAGE_ALREADY_CONNECTED'
      ? t('social.pageAlreadyConnected')
      : t('social.importError')
  } finally {
    importing.value = false
  }
}
</script>
<template>
  <DashboardPage :title="t('nav.socialPosts')" :description="t('legacy.socialPostsDescription')">
    <SocialConnections />
    <div class="flex flex-wrap items-end gap-3 mt-6">
      <UFormField :label="t('social.importFrom')"
        ><USelect v-model="importChannel" :items="['Facebook', 'Instagram']" :disabled="importing"
      /></UFormField>
      <UButton
        variant="outline"
        color="neutral"
        icon="i-lucide-refresh-cw"
        :loading="importing"
        :disabled="connection?.connection?.status !== 'connected'"
        @click="sync()"
        >{{ t('social.refreshPosts') }}</UButton
      >
      <UButton
        v-if="hasMore"
        variant="outline"
        color="neutral"
        :loading="importing"
        @click="sync(true)"
        >{{ t('social.loadOlder') }}</UButton
      >
    </div>
    <div class="flex flex-wrap gap-3 justify-between my-5">
      <UInput
        v-model="search"
        icon="i-lucide-search"
        :aria-label="t('social.searchImported')"
        :placeholder="t('social.searchText')"
        :maxlength="200"
      />
      <UTabs
        v-model="channel"
        :content="false"
        variant="link"
        :items="[
          { label: 'Facebook', value: 'Facebook' },
          { label: 'Instagram', value: 'Instagram' },
          { label: t('common.all'), value: 'all' },
        ]"
        :aria-label="t('social.filterNetwork')"
      />
    </div>
    <UCard
      v-if="result?.posts.length"
      :ui="{ body: 'p-0 sm:p-0' }"
      :aria-busy="status === 'pending'"
    >
      <div class="divide-y divide-default">
        <article v-for="post in result.posts" :key="post.id" class="flex items-center gap-4 p-4">
          <MediaImage :src="post.image || ''" alt="" class="size-16 shrink-0 rounded-md" />
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
      :actions="[{ label: t('content.createPost'), to: base + '/monthly-planner' }]"
    />
    <USlideover
      :open="!!selected"
      :title="t('social.postFromNetwork')"
      :description="t('social.postFromNetworkDescription')"
      @update:open="selected = $event ? selected : null"
    >
      <template #body
        ><div v-if="selected" class="space-y-5">
          <ChannelPreview
            :channel="selected.channel"
            :name="data.brand.name"
            :image="selected.image || ''"
            :caption="selected.caption"
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
