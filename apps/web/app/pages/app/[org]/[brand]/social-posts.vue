<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'workspace' })
useSeoMeta({ title: 'Postimet nga rrjetet · Rrit' })
const { data, base } = useWorkspace()
const page = ref(1)
const pageSize = ref(10)
const channel = ref<'all' | 'Facebook' | 'Instagram'>('all')
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
    message.value = `${response.imported} postime u kontrolluan dhe u përditësuan nga ${importChannel.value}.`
    await refresh()
    await refreshNuxtData('meta-status')
  } catch (problem) {
    error.value =
      (problem as { data?: { message?: string } }).data?.message || 'Importimi nuk u përfundua.'
  } finally {
    importing.value = false
  }
}
</script>
<template>
  <DashboardPage
    title="Postimet nga rrjetet"
    description="Postimet e biznesit tënd, të lexuara nga Facebook dhe Instagram."
  >
    <SocialConnections />
    <div class="flex flex-wrap items-end gap-3 mt-6">
      <UFormField label="Importo nga"
        ><USelect v-model="importChannel" :items="['Facebook', 'Instagram']" :disabled="importing"
      /></UFormField>
      <UButton
        variant="outline"
        color="neutral"
        icon="i-lucide-refresh-cw"
        :loading="importing"
        :disabled="connection?.connection?.status !== 'connected'"
        @click="sync()"
        >Përditëso postimet</UButton
      >
      <UButton
        v-if="hasMore"
        variant="outline"
        color="neutral"
        :loading="importing"
        @click="sync(true)"
        >Lexo postime më të vjetra</UButton
      >
    </div>
    <UAlert
      v-if="error || loadError"
      class="mt-4"
      color="error"
      variant="outline"
      :title="error || 'Postimet nuk u ngarkuan.'"
    />
    <p v-if="message" role="status" class="text-sm text-muted mt-4">{{ message }}</p>
    <div class="flex flex-wrap gap-3 justify-between my-5">
      <UInput
        v-model="search"
        icon="i-lucide-search"
        aria-label="Kërko te postimet e importuara"
        placeholder="Kërko në tekst…"
        :maxlength="200"
      />
      <UTabs
        v-model="channel"
        :content="false"
        variant="link"
        :items="[
          { label: 'Të gjitha', value: 'all' },
          { label: 'Facebook', value: 'Facebook' },
          { label: 'Instagram', value: 'Instagram' },
        ]"
        aria-label="Filtro rrjetin"
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
                  dateStyle: 'medium',
                  timeZone: data.preferences.timezone,
                }).format(new Date(post.publishedAt))
              }}
            </p>
            <p class="text-sm line-clamp-2 mt-1">{{ post.caption || 'Postim pa tekst' }}</p>
          </div>
          <UButton
            variant="outline"
            color="neutral"
            :aria-label="'Shiko postimin në ' + post.channel"
            @click="selected = post"
            >Shiko</UButton
          >
        </article>
      </div>
      <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="result.total" />
    </UCard>
    <DashboardEmpty
      v-else-if="status !== 'pending'"
      icon="i-lucide-images"
      title="Ende pa postime të importuara"
      description="Lidh biznesin dhe zgjidh Përditëso postimet. Nëse ke vendosur filtra, provo t’i pastrosh."
      :actions="[{ label: 'Krijo postim', to: base + '/content/new' }]"
    />
    <USlideover
      :open="!!selected"
      title="Postimi nga rrjeti"
      description="Përmbajtja e lexuar nga llogaria jote e lidhur."
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
            >Hap në {{ selected.channel }}</UButton
          >
          <p
            v-if="selected.mediaType === 'VIDEO' || selected.mediaType === 'CAROUSEL_ALBUM'"
            class="text-sm text-muted"
          >
            Për videon ose të gjitha fotografitë, hape postimin në rrjetin social.
          </p>
        </div></template
      >
    </USlideover>
  </DashboardPage>
</template>
