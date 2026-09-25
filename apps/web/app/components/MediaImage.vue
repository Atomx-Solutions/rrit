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
    class="relative overflow-hidden bg-elevated"
    :class="fit === 'natural' ? 'flex min-h-40 items-center justify-center' : ''"
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
