<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    src?: string
    alt: string
    width?: string | number
    height?: string | number
    loading?: 'eager' | 'lazy'
    fit?: 'cover' | 'contain' | 'natural'
  }>(),
  { loading: 'lazy', src: '', width: undefined, height: undefined, fit: 'cover' },
)
const failed = ref(false)
watch(
  () => props.src,
  () => {
    failed.value = false
  },
)
</script>
<template>
  <div
    class="relative overflow-hidden bg-elevated"
    :class="fit === 'natural' ? 'min-h-40' : ''"
  >
    <img
      v-if="src && !failed"
      :src="src"
      :alt="alt"
      :width="width"
      :height="height"
      :loading="loading"
      :class="
        fit === 'natural'
          ? 'block w-full h-auto object-contain'
          : fit === 'contain'
            ? 'size-full object-contain'
            : 'size-full object-cover'
      "
      @error="failed = true"
    />
    <div
      v-else
      role="img"
      :aria-label="
        alt ? `Fotografia nuk është e disponueshme: ${alt}` : 'Fotografia nuk është e disponueshme'
      "
      class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted p-2"
    >
      <UIcon name="i-lucide-image-off" class="size-5 shrink-0" />
      <span class="sr-only">Fotografia nuk është e disponueshme</span>
    </div>
  </div>
</template>
