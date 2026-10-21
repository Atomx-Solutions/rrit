<script setup lang="ts">
import { channelCanvas, type PublishingChannel } from '~~/shared/schemas/channel-format'

const { t } = useI18n()
const props = defineProps<{
  channel: PublishingChannel
  name: string
  image: string
  caption: string
  videoUrl?: string | null
}>()
// The frame the channel shows. Media in another shape is letterboxed inside
// it rather than cropped, so a file of the wrong size is visible as such.
const frame = computed(() => {
  const { width, height } = channelCanvas(props.channel)
  return { aspectRatio: `${width} / ${height}` }
})
</script>
<template>
  <UCard
    as="article"
    :aria-label="`${t('preview.preview')}: ${channel}`"
    :ui="{ body: 'p-0 sm:p-0' }"
    class="w-full max-w-sm mx-auto overflow-hidden"
  >
    <div
      v-if="channel === 'TikTok'"
      class="relative overflow-hidden rounded-2xl bg-black text-white"
      :style="frame"
    >
      <video
        v-if="videoUrl"
        :src="videoUrl"
        :poster="image"
        controls
        playsinline
        preload="metadata"
        class="absolute inset-x-0 top-0 h-[calc(100%-3rem)] w-full object-cover"
      />
      <MediaImage
        v-else-if="image"
        :src="image"
        :alt="t('preview.selectedPhoto')"
        fit="cover"
        class="absolute inset-x-0 top-0 h-[calc(100%-3rem)] w-full"
      />
      <DashboardEmpty
        v-else
        :title="t('preview.choosePhoto')"
        :description="t('preview.addPhotoDescription')"
        icon="i-lucide-image"
      />
      <div
        class="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black/55 to-transparent"
      />
      <div
        class="pointer-events-none absolute left-4 right-4 top-4 flex items-center justify-between text-sm font-semibold drop-shadow-lg"
      >
        <UIcon name="i-lucide-radio" class="size-5" />
        <div class="flex items-center gap-3">
          <span class="text-white/70">Following</span>
          <span class="h-4 w-px bg-white/50" />
          <span class="border-b-2 border-white pb-1">For You</span>
        </div>
        <UIcon name="i-lucide-search" class="size-5" />
      </div>
      <div class="pointer-events-none absolute bottom-24 left-4 right-16 text-sm drop-shadow-lg">
        <p class="font-semibold">@{{ name.replaceAll(' ', '') }}</p>
        <p class="mt-2 line-clamp-3 whitespace-pre-wrap break-words">
          {{ caption || t('preview.captionPlaceholder') }}
        </p>
        <p class="mt-2 flex items-center gap-1 text-xs">
          <UIcon name="i-lucide-music-2" class="size-3" /> original sound
        </p>
      </div>
      <div
        class="pointer-events-none absolute bottom-28 right-3 flex flex-col items-center gap-5 drop-shadow-lg"
        aria-hidden="true"
      >
        <span
          class="flex size-9 items-center justify-center rounded-full bg-white/20 text-xs font-bold"
          >{{ name.slice(0, 1) }}</span
        >
        <UIcon name="i-lucide-heart" class="size-7" />
        <UIcon name="i-lucide-message-circle" class="size-7" />
        <UIcon name="i-lucide-bookmark" class="size-7" />
        <UIcon name="i-lucide-share-2" class="size-7" />
      </div>
      <div
        class="pointer-events-none absolute inset-x-0 bottom-0 flex h-12 items-center justify-around bg-black text-white"
        aria-hidden="true"
      >
        <UIcon name="i-lucide-house" class="size-5" />
        <UIcon name="i-lucide-users-round" class="size-5" />
        <span
          class="flex h-7 w-10 items-center justify-center rounded-md bg-white text-black ring-2 ring-cyan-400"
          ><UIcon name="i-lucide-plus" class="size-5"
        /></span>
        <UIcon name="i-lucide-message-square" class="size-5" />
        <UIcon name="i-lucide-user-round" class="size-5" />
      </div>
    </div>
    <template v-else>
      <header class="flex items-center gap-3 p-4">
        <UAvatar :alt="name" size="sm" />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold truncate">{{ name }}</p>
          <p class="text-xs text-muted flex items-center gap-1 mt-0.5">
            {{ t('preview.preview') }}
            <UIcon v-if="channel === 'Facebook'" name="i-lucide-globe" class="size-3" />
          </p>
        </div>
        <UIcon :name="channelIcon(channel)" class="size-4 text-muted shrink-0" />
      </header>
      <p
        v-if="channel === 'Facebook'"
        class="px-4 pb-4 text-sm whitespace-pre-wrap break-words leading-relaxed"
      >
        {{ caption || t('preview.captionPlaceholder') }}
      </p>
      <video
        v-if="videoUrl"
        :src="videoUrl"
        :poster="image"
        controls
        playsinline
        preload="metadata"
        class="w-full bg-black object-contain"
        :style="frame"
      />
      <MediaImage
        v-else-if="image"
        :src="image"
        :alt="t('preview.selectedPhoto')"
        fit="contain"
        class="w-full"
        :style="frame"
      />
      <DashboardEmpty
        v-else
        :title="t('preview.choosePhoto')"
        :description="t('preview.addPhotoDescription')"
        icon="i-lucide-image"
        class="border-x-0 rounded-none"
      />
      <template v-if="channel === 'Instagram'">
        <div class="flex items-center gap-4 px-4 pt-4" aria-hidden="true">
          <UIcon name="i-lucide-heart" class="size-5" /><UIcon
            name="i-lucide-message-circle"
            class="size-5"
          /><UIcon name="i-lucide-send" class="size-5" /><UIcon
            name="i-lucide-bookmark"
            class="size-5 ml-auto"
          />
        </div>
        <p class="p-4 text-sm leading-relaxed whitespace-pre-wrap break-words">
          <strong>{{ name }}</strong> {{ caption || t('preview.captionPlaceholder') }}
        </p>
      </template>
      <div
        v-else
        class="flex justify-around gap-2 p-3 border-t border-default text-xs text-muted"
        aria-hidden="true"
      >
        <span class="flex items-center gap-1.5"
          ><UIcon name="i-lucide-thumbs-up" class="size-4" />{{ t('preview.like') }}</span
        ><span class="flex items-center gap-1.5"
          ><UIcon name="i-lucide-message-circle" class="size-4" />{{ t('preview.comment') }}</span
        ><span class="flex items-center gap-1.5"
          ><UIcon name="i-lucide-share-2" class="size-4" />{{ t('preview.share') }}</span
        >
      </div>
    </template>
  </UCard>
</template>
