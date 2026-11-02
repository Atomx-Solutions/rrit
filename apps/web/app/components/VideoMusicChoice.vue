<script setup lang="ts">
import { musicMoodName, type MusicMood, type MusicTrack, type VideoMusicChoice as MusicChoice } from '~~/shared/schemas/music'

// AI music, a library track or none: the one choice every video is made with.
// Null until the business picks one.
const choice = defineModel<MusicChoice | null>({ required: true })
// AI music is made with the video, so a finished video offers only the others.
const props = defineProps<{ withoutAi?: boolean }>()
const { t, language } = useI18n()
const sources = computed(() => [
  { value: 'ai' as const, label: t('videoMusic.ai'), icon: 'i-lucide-wand-sparkles' },
  { value: 'library' as const, label: t('videoMusic.library'), icon: 'i-lucide-library' },
  { value: 'none' as const, label: t('videoMusic.none'), icon: 'i-lucide-volume-x' },
].filter((option) => !props.withoutAi || option.value !== 'ai'))

const tracks = ref<MusicTrack[] | null>(null)
const error = ref('')

const source = computed(() => choice.value?.source)
const chosenTrack = computed(() => tracks.value?.find((track) => track.id === choice.value?.trackId))
const moods = ref<MusicMood[]>([])
const byMood = computed(() => moods.value
  .map((mood) => ({
    mood: mood.slug,
    name: musicMoodName(mood, language.value),
    tracks: (tracks.value || []).filter((track) => track.mood === mood.slug),
  }))
  .filter((group) => group.tracks.length)
  .sort((a, b) => a.name.localeCompare(b.name)))
const { playing, toggle, stop } = useTrackPreview()
onBeforeUnmount(stop)

// The library is chosen from in a window of its own. What is picked there is
// a draft until it is used, so closing the window leaves the choice as it was.
const libraryOpen = ref(false)
const trackId = ref<string>()
function choose(value: MusicChoice['source']) {
  if (value !== 'library') {
    choice.value = { source: value }
    return
  }
  trackId.value = choice.value?.trackId
  const mood = chosenTrack.value?.mood
  openMoods.value = new Set(mood ? [mood] : [])
  libraryOpen.value = true
}
function useTrack() {
  if (!trackId.value) return
  choice.value = { source: 'library', trackId: trackId.value }
  libraryOpen.value = false
}
// The window's music stops with it.
watch(libraryOpen, (open) => { if (!open) stop() })
// Choosing a track plays it, so the business hears what it picked; choosing
// it again lets it go.
function pick(id: string) {
  if (trackId.value === id) {
    trackId.value = undefined
    if (playing.value === id) stop()
    return
  }
  trackId.value = id
  if (playing.value !== id) toggle(id)
}

// Each mood folds away; only the one holding the chosen track starts open.
const openMoods = ref(new Set<string>())
// One mood open at a time: opening another folds the one before.
function toggleMood(mood: string) {
  openMoods.value = openMoods.value.has(mood) ? new Set() : new Set([mood])
}

function minutes(seconds: number) {
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

onMounted(async () => {
  try {
    const library = await $fetch('/api/music')
    moods.value = library.moods
    tracks.value = library.tracks
  } catch {
    tracks.value = []
    error.value = t('videoMusic.libraryUnavailable')
  }
})
</script>

<template>
  <div>
    <div class="grid gap-2" :class="sources.length === 2 ? 'grid-cols-2' : 'grid-cols-3'">
      <UButton
        v-for="option in sources"
        :key="option.value"
        block
        :icon="option.icon"
        :color="source === option.value ? 'primary' : 'neutral'"
        :variant="source === option.value ? 'soft' : 'outline'"
        :aria-pressed="source === option.value"
        class="h-auto flex-col gap-1 py-2 text-xs"
        @click="choose(option.value)"
      >{{ option.label }}</UButton>
    </div>
    <div v-if="source === 'library' && chosenTrack" class="mt-2 flex items-center gap-2 rounded-lg bg-primary/10 px-2 py-1 text-sm text-primary">
      <UIcon name="i-lucide-music" class="size-4 shrink-0" />
      <span class="min-w-0 flex-1 truncate">{{ chosenTrack.title }}</span>
      <UButton
        size="xs"
        :color="playing === chosenTrack.id ? 'primary' : 'neutral'"
        :variant="playing === chosenTrack.id ? 'solid' : 'ghost'"
        :icon="playing === chosenTrack.id ? 'i-lucide-pause' : 'i-lucide-play'"
        class="shrink-0 rounded-full"
        :aria-label="t(playing === chosenTrack.id ? 'videoMusic.pause' : 'videoMusic.play', { title: chosenTrack.title })"
        @click="toggle(chosenTrack.id)"
      />
      <UButton size="xs" color="neutral" variant="link" class="shrink-0" @click="choose('library')">
        {{ t('videoMusic.change') }}
      </UButton>
    </div>
    <UModal
      v-model:open="libraryOpen"
      :title="t('videoMusic.chooseTrack')"
      :ui="{ content: 'sm:max-w-md', title: 'text-base' }"
    >
      <template #body>
      <div class="space-y-1">
      <p v-if="tracks && !tracks.length && !error" class="text-sm text-muted">{{ t('videoMusic.empty') }}</p>
      <div v-for="group in byMood" :key="group.mood">
        <UButton
          block
          color="neutral"
          variant="ghost"
          size="sm"
          trailing-icon="i-lucide-chevron-down"
          :ui="{ trailingIcon: openMoods.has(group.mood) ? 'rotate-180 transition-transform duration-200' : 'transition-transform duration-200' }"
          :aria-expanded="openMoods.has(group.mood)"
          class="justify-between text-xs font-semibold uppercase text-muted"
          @click="toggleMood(group.mood)"
        >
          <span>{{ group.name }} <span class="font-normal">· {{ group.tracks.length }}</span></span>
        </UButton>
        <Transition :css="false" @enter="(element, done) => slide(element, true, done)" @leave="(element, done) => slide(element, false, done)">
        <div v-if="openMoods.has(group.mood)" role="radiogroup" class="mt-1 space-y-1">
          <div
            v-for="track in group.tracks"
            :key="track.id"
            role="radio"
            tabindex="0"
            :aria-checked="trackId === track.id"
            class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm transition"
            :class="trackId === track.id ? 'bg-primary/10 text-primary' : 'hover:bg-elevated'"
            @click="pick(track.id)"
            @keydown.enter.prevent="pick(track.id)"
            @keydown.space.prevent="pick(track.id)"
          >
            <UIcon
              :name="trackId === track.id ? 'i-lucide-circle-check' : 'i-lucide-circle'"
              class="size-4 shrink-0"
              :class="trackId === track.id ? 'text-primary' : 'text-muted'"
            />
            <span class="min-w-0 flex-1 truncate">{{ track.title }}</span>
            <span class="shrink-0 text-xs text-muted">{{ minutes(track.durationSeconds) }}</span>
            <UButton
              size="xs"
              :color="playing === track.id ? 'primary' : 'neutral'"
              :variant="playing === track.id ? 'solid' : 'ghost'"
              :icon="playing === track.id ? 'i-lucide-pause' : 'i-lucide-play'"
              class="shrink-0 rounded-full"
              :aria-label="t(playing === track.id ? 'videoMusic.pause' : 'videoMusic.play', { title: track.title })"
              @click.stop="toggle(track.id)"
            />
          </div>
        </div>
        </Transition>
      </div>
      </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="outline" @click="libraryOpen = false">{{ t('common.cancel') }}</UButton>
          <UButton icon="i-lucide-check" :disabled="!trackId" @click="useTrack">{{ t('videoMusic.useTrack') }}</UButton>
        </div>
      </template>
    </UModal>
    <UAlert v-if="error" class="mt-4" color="error" variant="subtle" :description="error" />
  </div>
</template>
