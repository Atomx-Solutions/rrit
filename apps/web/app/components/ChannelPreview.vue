<script setup lang="ts">
const { t } = useI18n()
defineProps<{ channel: 'Instagram' | 'Facebook' | 'TikTok'; name: string; image: string; caption: string }>()
</script>
<template>
  <UCard
    as="article"
    :aria-label="`${t('preview.preview')}: ${channel}`"
    :ui="{ body: 'p-0 sm:p-0' }"
    class="w-full max-w-sm mx-auto overflow-hidden"
  >
    <header class="flex items-center gap-3 p-4">
      <UAvatar :alt="name" size="sm" />
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold truncate">{{ name }}</p>
        <p class="text-xs text-muted flex items-center gap-1 mt-0.5">
          {{ t('preview.preview') }} <UIcon v-if="channel === 'Facebook'" name="i-lucide-globe" class="size-3" />
        </p>
      </div>
      <UIcon
        :name="channel === 'Instagram' ? 'i-lucide-instagram' : channel === 'TikTok' ? 'i-lucide-music' : 'i-lucide-facebook'"
        class="size-4 text-muted shrink-0"
      />
    </header>
    <p
      v-if="channel === 'Facebook'"
      class="px-4 pb-4 text-sm whitespace-pre-wrap break-words leading-relaxed"
    >
      {{ caption || t('preview.captionPlaceholder') }}
    </p>
    <MediaImage
      v-if="image"
      :src="image"
      :alt="t('preview.selectedPhoto')"
      fit="natural"
      class="w-full"
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
  </UCard>
</template>
