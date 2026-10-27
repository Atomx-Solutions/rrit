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
// The Facebook reactions can be tried in the preview the way they work on
// Facebook: hovering Like opens the reaction bar, a click likes or unlikes.
// The choice is local to the preview and never saved.
const reactions = [
  { key: 'like', emoji: '👍' },
  { key: 'love', emoji: '❤️' },
  { key: 'care', emoji: '🥰' },
  { key: 'haha', emoji: '😆' },
  { key: 'wow', emoji: '😮' },
] as const
type Reaction = (typeof reactions)[number]['key']
const reaction = ref<Reaction | null>(null)
const chosen = computed(() => reactions.find((item) => item.key === reaction.value))
const reactionsOpen = ref(false)
let reactionsTimer: ReturnType<typeof setTimeout> | undefined
function showReactions(open: boolean) {
  clearTimeout(reactionsTimer)
  reactionsTimer = setTimeout(() => (reactionsOpen.value = open), open ? 450 : 250)
}
function react(key: Reaction | null) {
  clearTimeout(reactionsTimer)
  reactionsOpen.value = false
  reaction.value = key
}
onBeforeUnmount(() => clearTimeout(reactionsTimer))
// The Instagram like works the same way: the heart fills red and pops, and a
// double tap on the photo likes it with a heart over the photo.
const instagramLiked = ref(false)
const instagramBurst = ref(0)
function likeOnInstagram() {
  instagramLiked.value = true
  instagramBurst.value++
}
// TikTok likes the same way: the side heart turns red, and a double tap on
// the photo drops a tilted red heart where it was tapped.
const tiktokLiked = ref(false)
const tiktokHearts = ref<{ id: number; x: number; y: number; tilt: number }[]>([])
let tiktokHeartId = 0
function likeOnTiktok(event: MouseEvent) {
  const frame = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const id = ++tiktokHeartId
  tiktokLiked.value = true
  tiktokHearts.value.push({
    id,
    x: event.clientX - frame.left,
    y: event.clientY - frame.top,
    tilt: Math.round(Math.random() * 50 - 25),
  })
  setTimeout(() => (tiktokHearts.value = tiktokHearts.value.filter((heart) => heart.id !== id)), 900)
}
// Lucide's heart, drawn here so it can be filled when liked.
const heartPath = 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z'
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
      <div
        v-else-if="image"
        class="absolute inset-x-0 top-0 h-[calc(100%-3rem)] w-full overflow-hidden"
        @dblclick="likeOnTiktok"
      >
        <MediaImage :src="image" :alt="t('preview.selectedPhoto')" fit="cover" class="size-full" />
        <svg
          v-for="heart in tiktokHearts"
          :key="heart.id"
          viewBox="0 0 24 24"
          class="tiktok-like-burst pointer-events-none absolute size-20"
          :style="{ left: `${heart.x}px`, top: `${heart.y}px`, '--tilt': `${heart.tilt}deg` }"
          aria-hidden="true"
        >
          <path :d="heartPath" fill="currentColor" />
        </svg>
      </div>
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
      >
        <span
          class="flex size-9 items-center justify-center rounded-full bg-white/20 text-xs font-bold"
          aria-hidden="true"
          >{{ name.slice(0, 1) }}</span
        >
        <UButton
          variant="link"
          color="neutral"
          class="pointer-events-auto p-0"
          :class="tiktokLiked ? 'tiktok-liked' : 'text-white hover:text-white'"
          :aria-label="t('preview.like')"
          :aria-pressed="tiktokLiked"
          @click="tiktokLiked = !tiktokLiked"
        >
          <svg :key="String(tiktokLiked)" viewBox="0 0 24 24" class="tiktok-like-icon size-7" aria-hidden="true">
            <path :d="heartPath" fill="currentColor" />
          </svg>
        </UButton>
        <UIcon name="i-lucide-message-circle" class="size-7" aria-hidden="true" />
        <UIcon name="i-lucide-bookmark" class="size-7" aria-hidden="true" />
        <UIcon name="i-lucide-share-2" class="size-7" aria-hidden="true" />
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
      <div
        v-else-if="image"
        class="relative"
        @dblclick="channel === 'Instagram' && likeOnInstagram()"
      >
        <MediaImage
          :src="image"
          :alt="t('preview.selectedPhoto')"
          fit="contain"
          class="w-full"
          :style="frame"
        />
        <svg
          v-if="channel === 'Instagram' && instagramBurst"
          :key="instagramBurst"
          viewBox="0 0 24 24"
          class="instagram-like-burst pointer-events-none absolute left-1/2 top-1/2 size-24 text-white"
          aria-hidden="true"
        >
          <path :d="heartPath" fill="currentColor" />
        </svg>
      </div>
      <DashboardEmpty
        v-else
        :title="t('preview.choosePhoto')"
        :description="t('preview.addPhotoDescription')"
        icon="i-lucide-image"
        class="border-x-0 rounded-none"
      />
      <template v-if="channel === 'Instagram'">
        <div class="flex items-center gap-4 px-4 pt-4">
          <UButton
            variant="link"
            color="neutral"
            class="p-0"
            :class="instagramLiked ? 'instagram-liked' : 'text-default'"
            :aria-label="t('preview.like')"
            :aria-pressed="instagramLiked"
            @click="instagramLiked = !instagramLiked"
          >
            <svg
              :key="String(instagramLiked)"
              viewBox="0 0 24 24"
              class="instagram-like-icon size-5"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path :d="heartPath" :fill="instagramLiked ? 'currentColor' : 'none'" />
            </svg>
          </UButton>
          <span class="flex flex-1 items-center gap-4" aria-hidden="true"
            ><UIcon name="i-lucide-message-circle" class="size-5" /><UIcon
              name="i-lucide-send"
              class="size-5"
            /><UIcon name="i-lucide-bookmark" class="size-5 ml-auto"
          /></span>
        </div>
        <p class="p-4 text-sm leading-relaxed whitespace-pre-wrap break-words">
          <strong>{{ name }}</strong> {{ caption || t('preview.captionPlaceholder') }}
        </p>
      </template>
      <div
        v-else
        class="flex justify-around gap-2 p-3 border-t border-default text-xs text-muted"
      >
        <div
          class="relative"
          @mouseenter="showReactions(true)"
          @mouseleave="showReactions(false)"
          @focusin="showReactions(true)"
          @focusout="showReactions(false)"
        >
          <Transition name="facebook-reactions">
            <div
              v-if="reactionsOpen"
              role="toolbar"
              :aria-label="t('preview.reactions')"
              class="facebook-reaction-bar absolute bottom-full -left-1 z-10 mb-1.5 flex items-center gap-0.5 rounded-full bg-default p-1"
            >
              <UButton
                v-for="(item, index) in reactions"
                :key="item.key"
                variant="link"
                color="neutral"
                class="facebook-reaction group relative p-0"
                :style="{ animationDelay: `${index * 35}ms` }"
                :aria-label="t(`preview.${item.key}`)"
                @click="react(item.key)"
              >
                <span class="facebook-reaction-emoji text-[30px] leading-none">{{ item.emoji }}</span>
                <span
                  class="facebook-reaction-label pointer-events-none absolute -top-8 left-1/2 whitespace-nowrap rounded-full bg-black/75 px-2 py-0.5 text-xs font-semibold text-white"
                  >{{ t(`preview.${item.key}`) }}</span
                >
              </UButton>
            </div>
          </Transition>
          <UButton
            variant="link"
            color="neutral"
            size="xs"
            class="facebook-like gap-1.5 p-0 text-xs"
            :class="chosen ? `is-reacted font-semibold facebook-like-${chosen.key}` : 'text-muted'"
            :aria-pressed="!!chosen"
            @click="react(chosen ? null : 'like')"
          >
            <span v-if="chosen && chosen.key !== 'like'" :key="chosen.key" class="facebook-like-icon text-base leading-none">{{ chosen.emoji }}</span>
            <UIcon v-else :key="String(!!chosen)" name="i-lucide-thumbs-up" class="facebook-like-icon size-4" />{{ t(`preview.${chosen?.key || 'like'}`) }}
          </UButton>
        </div><span class="flex items-center gap-1.5" aria-hidden="true"
          ><UIcon name="i-lucide-message-circle" class="size-4" />{{ t('preview.comment') }}</span
        ><span class="flex items-center gap-1.5" aria-hidden="true"
          ><UIcon name="i-lucide-share-2" class="size-4" />{{ t('preview.share') }}</span
        >
      </div>
    </template>
  </UCard>
</template>
