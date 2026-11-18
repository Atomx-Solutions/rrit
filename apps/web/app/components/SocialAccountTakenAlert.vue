<script setup lang="ts">
// Shown when the chosen account is already connected to another business.
const { t } = useI18n()
</script>
<template>
  <p class="flex items-start gap-1.5 text-sm text-warning">
    <UIcon name="i-lucide-info" class="mt-0.5 size-4 shrink-0" />
    <span>{{ t('social.takenUseAnother') }}</span>
  </p>
</template>
