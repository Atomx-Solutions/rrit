<script setup lang="ts">
import type { VideoMusic, VideoMusicChoice as MusicChoice } from '~~/shared/schemas/music'

// aiKept: the video keeps the AI music it was made with, so it can return to it.
const props = defineProps<{ postId: string; music?: VideoMusic; aiKept?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ changed: [remixed: boolean] }>()
const { t } = useI18n()

const open = ref(false)
const busy = ref(false)
const error = ref('')
// A finished video's music is a library track, none, or the AI music it was
// made with; new AI music is only made with a new video.
const choice = ref<MusicChoice | null>(null)
const canSave = computed(() => !!choice.value && (choice.value.source !== 'library' || !!choice.value.trackId))

function show() {
  choice.value = props.music?.source === 'library'
    ? { source: 'library', trackId: props.music.trackId }
    : props.music?.source === 'none' || (props.music?.source === 'ai' && props.aiKept)
      ? { source: props.music.source }
      : null
  error.value = ''
  open.value = true
}

async function save() {
  if (!canSave.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const result = await $fetch(`/api/posts/${props.postId}/video-music`, {
      method: 'POST',
      body: choice.value,
      retry: 0,
    })
    open.value = false
    emit('changed', result.remixed)
  } catch (problem) {
    error.value = t((problem as { data?: { message?: string } }).data?.message || 'videoMusic.failed')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UButton
    size="sm"
    variant="outline"
    color="neutral"
    icon="i-lucide-music"
    :disabled="disabled"
    @click="show"
  >{{ t('videoMusic.button') }}</UButton>
  <UModal
    v-model:open="open"
    :title="t('videoMusic.title')"
    :description="t('videoMusic.description')"
    :ui="{ content: 'sm:max-w-lg' }"
  >
    <template #body>
      <VideoMusicChoice v-model="choice" :without-ai="!aiKept" />
      <UAlert v-if="error" class="mt-4" color="error" variant="subtle" :description="error" />
      <div class="mt-4 flex justify-end">
        <UButton icon="i-lucide-check" :loading="busy" :disabled="!canSave" @click="save">
          {{ t('videoMusic.save') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
