<script setup lang="ts">
import { publishingChannels, type PublishingChannel } from '~~/shared/schemas/channel-format'
import type { VideoMusicChoice as MusicChoice } from '~~/shared/schemas/music'

// Where each post and video of a planner request goes, and the music of each
// video. Nothing is chosen for the business: the request is sent only once
// every post and video has its own choice. Posts come first, then videos; a
// request with only one kind has one step.
export type PlannerRequestChoice = {
  posts: PublishingChannel[]
  videos: { channel: PublishingChannel; music: MusicChoice }[]
}

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ postCount: number; videoCount: number; busy?: boolean; submitLabel: string }>()
const emit = defineEmits<{ submit: [choice: PlannerRequestChoice] }>()
const { t } = useI18n()

const channelOptions = publishingChannels.map((channel) => ({ value: channel, label: channel, icon: channelIcon(channel) }))
const channelLabel = (channel: PublishingChannel | null) =>
  channel ? channelOptions.find((option) => option.value === channel)?.label : t('videoMusic.choosePlatform')

const postRows = ref<(PublishingChannel | null)[]>([])
const videoRows = ref<{ channel: PublishingChannel | null; music: MusicChoice | null }[]>([])
watch(() => props.postCount, (count) => {
  postRows.value = Array.from({ length: count }, (_, index) => postRows.value[index] ?? null)
}, { immediate: true })
watch(() => props.videoCount, (count) => {
  videoRows.value = Array.from({ length: count }, (_, index) => videoRows.value[index] || { channel: null, music: null })
}, { immediate: true })

const postsChosen = computed(() => postRows.value.every(Boolean))
const videoChosen = (row: (typeof videoRows.value)[number]) =>
  !!row.channel && !!row.music && (row.music.source !== 'library' || !!row.music.trackId)
const videosChosen = computed(() => videoRows.value.every(videoChosen))

const step = ref<'posts' | 'videos'>(props.postCount > 0 ? 'posts' : 'videos')
const hasSteps = computed(() => props.postCount > 0 && props.videoCount > 0)
watch(open, (value) => { if (value) step.value = props.postCount ? 'posts' : 'videos' }, { immediate: true })

function submit() {
  if (!postsChosen.value || !videosChosen.value) return
  emit('submit', {
    posts: postRows.value as PublishingChannel[],
    videos: videoRows.value as PlannerRequestChoice['videos'],
  })
}
</script>

<template>
  <!-- As tall as what it holds, up to most of the screen; a long list of
       posts or videos scrolls inside. -->
  <UModal
    v-model:open="open"
    :title="t('monthly.requestMixedTitle')"
    :ui="{ title: 'truncate text-base', content: 'sm:max-w-2xl', body: 'max-h-[65dvh] overflow-y-auto' }"
  >
    <template #body>
      <div v-if="hasSteps" class="mb-3 grid grid-cols-2 gap-2 text-xs font-semibold">
        <span
          v-for="(item, index) in (['posts', 'videos'] as const)"
          :key="item"
          class="flex items-center gap-1.5 rounded-lg px-2 py-1.5"
          :class="step === item ? 'bg-primary/10 text-primary' : 'text-muted'"
        >
          <span
            class="flex size-5 items-center justify-center rounded-full text-[11px]"
            :class="step === item ? 'bg-primary text-inverted' : 'bg-elevated'"
          >{{ index + 1 }}</span>
          {{ item === 'posts' ? t('monthly.postPlatforms') : t('monthly.videoPlatforms') }}
        </span>
      </div>
      <Transition mode="out-in" enter-active-class="transition-opacity duration-150" enter-from-class="opacity-0" leave-active-class="transition-opacity duration-150" leave-to-class="opacity-0">
        <div v-if="step === 'posts'" key="posts" class="space-y-2">
          <div v-for="(channel, index) in postRows" :key="index" class="rounded-xl border border-default p-2.5">
            <p v-if="postRows.length > 1" class="mb-2 flex items-center gap-1.5 text-xs">
              <UIcon name="i-lucide-image" class="size-3.5 shrink-0 text-primary" />
              <span class="font-semibold text-highlighted">{{ t('monthly.postNumber', { number: index + 1 }) }}</span>
              <span :class="channel ? 'text-muted' : 'text-error'">· {{ channelLabel(channel) }}</span>
            </p>
            <ChannelButtons v-model="postRows[index]!" :options="channelOptions" />
          </div>
        </div>
        <div v-else key="videos" class="space-y-2">
          <div v-for="(row, index) in videoRows" :key="index" class="rounded-xl border border-default p-2.5">
            <p v-if="videoRows.length > 1" class="mb-2 flex min-w-0 items-center gap-1.5 text-xs">
              <UIcon name="i-lucide-clapperboard" class="size-3.5 shrink-0 text-primary" />
              <span class="font-semibold text-highlighted">{{ t('videoMusic.videoNumber', { number: index + 1 }) }}</span>
              <span class="truncate" :class="videoChosen(row) ? 'text-muted' : 'text-error'">
                · {{ channelLabel(row.channel) }}
                · {{ row.music ? t(`videoMusic.${row.music.source}`) : t('videoMusic.chooseMusic') }}
              </span>
            </p>
            <p class="mb-1.5 text-xs font-semibold text-muted">{{ t('monthly.choosePlatform') }}</p>
            <ChannelButtons v-model="row.channel" :options="channelOptions" />
            <p class="mb-1.5 mt-3 text-xs font-semibold text-muted">{{ t('videoMusic.chooseMusic') }}</p>
            <VideoMusicChoice v-model="row.music" />
          </div>
        </div>
      </Transition>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          v-if="hasSteps && step === 'videos'"
          color="neutral"
          variant="outline"
          icon="i-lucide-chevron-left"
          @click="step = 'posts'"
        >{{ t('common.back') }}</UButton>
        <UButton v-else color="neutral" variant="outline" @click="open = false">{{ t('common.cancel') }}</UButton>
        <UButton
          v-if="hasSteps && step === 'posts'"
          trailing-icon="i-lucide-chevron-right"
          :disabled="!postsChosen"
          @click="step = 'videos'"
        >{{ t('common.next') }}</UButton>
        <UButton v-else :loading="busy" :disabled="!postsChosen || !videosChosen" @click="submit">{{ submitLabel }}</UButton>
      </div>
    </template>
  </UModal>
</template>
