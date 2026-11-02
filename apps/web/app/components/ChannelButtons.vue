<script setup lang="ts">
import type { PublishingChannel } from '~~/shared/schemas/channel-format'

// Instagram, Facebook or TikTok as three buttons; none chosen until clicked.
const channel = defineModel<PublishingChannel | null>({ required: true })
defineProps<{ options: { value: PublishingChannel; label: string; icon: string }[] }>()
</script>

<template>
  <div class="grid grid-cols-3 gap-2">
    <UButton
      v-for="option in options"
      :key="option.value"
      block
      :color="channel === option.value ? 'primary' : 'neutral'"
      :variant="channel === option.value ? 'soft' : 'outline'"
      :aria-pressed="channel === option.value"
      class="h-auto flex-col gap-1 py-2 text-xs"
      @click="channel = option.value"
    >
      <TikTokMark v-if="option.value === 'TikTok'" class="size-5" />
      <UIcon v-else :name="option.icon" class="size-5" />
      {{ option.label }}
    </UButton>
  </div>
</template>
