<script setup lang="ts">
defineProps<{ channel: 'Instagram' | 'Facebook'; name: string; image: string; caption: string }>()
</script>
<template>
  <UCard
    as="article"
    :aria-label="`Parapamja në ${channel}`"
    :ui="{ body: 'p-0 sm:p-0' }"
    class="w-full max-w-sm mx-auto overflow-hidden"
  >
    <header class="flex items-center gap-3 p-4">
      <UAvatar :alt="name" size="sm" />
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold truncate">{{ name }}</p>
        <p class="text-xs text-muted flex items-center gap-1 mt-0.5">
          Parapamje <UIcon v-if="channel === 'Facebook'" name="i-lucide-globe" class="size-3" />
        </p>
      </div>
      <UIcon
        :name="channel === 'Instagram' ? 'i-lucide-instagram' : 'i-lucide-facebook'"
        class="size-4 text-muted shrink-0"
      />
    </header>
    <p
      v-if="channel === 'Facebook'"
      class="px-4 pb-4 text-sm whitespace-pre-wrap break-words leading-relaxed"
    >
      {{ caption || 'Teksti yt do të shfaqet këtu.' }}
    </p>
    <MediaImage
      v-if="image"
      :src="image"
      alt="Fotografia e zgjedhur për postim"
      fit="natural"
      class="w-full"
    />
    <DashboardEmpty
      v-else
      title="Zgjidh një fotografi"
      description="Shto një fotografi për ta parë postimin e plotë."
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
        <strong>{{ name }}</strong> {{ caption || 'Teksti yt do të shfaqet këtu.' }}
      </p>
    </template>
    <div
      v-else
      class="flex justify-around gap-2 p-3 border-t border-default text-xs text-muted"
      aria-hidden="true"
    >
      <span class="flex items-center gap-1.5"
        ><UIcon name="i-lucide-thumbs-up" class="size-4" />Pëlqe</span
      ><span class="flex items-center gap-1.5"
        ><UIcon name="i-lucide-message-circle" class="size-4" />Komento</span
      ><span class="flex items-center gap-1.5"
        ><UIcon name="i-lucide-share-2" class="size-4" />Shpërndaj</span
      >
    </div>
  </UCard>
</template>
