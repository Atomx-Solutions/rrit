<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    src?: string
    alt: string
    width?: string | number
    height?: string | number
    loading?: 'eager' | 'lazy'
    fit?: 'cover' | 'contain' | 'natural'
    // A viewer that supplies its own backdrop needs the frame to disappear:
    // otherwise the placeholder surface is painted across the whole stage and
    // reads as a grey slab around a small picture.
    surface?: boolean
  }>(),
  {
    loading: 'lazy',
    src: '',
    width: undefined,
    height: undefined,
    fit: 'cover',
    surface: true,
  },
)
const { t } = useI18n()
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
    class="relative overflow-hidden"
    :class="[
      surface ? 'bg-elevated' : '',
      fit === 'natural' ? 'flex items-center justify-center' : '',
      fit === 'natural' && surface ? 'min-h-40' : '',
    ]"
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
          ? 'block size-auto max-h-full max-w-full object-contain'
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
        alt ? `${t('content.photoUnavailable')}: ${alt}` : t('content.photoUnavailable')
      "
      class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted p-2"
    >
      <UIcon name="i-lucide-image-off" class="size-5 shrink-0" />
      <span class="sr-only">{{ t('content.photoUnavailable') }}</span>
    </div>
  </div>
</template>
