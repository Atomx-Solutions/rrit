<script setup lang="ts">
// Shown when the chosen account is already connected to another business.
const { t } = useI18n()
</script>
<template>
  <!-- Small in the narrow phone and desktop cards so it keeps to two lines;
       the full-width tablet row has room for regular text. -->
  <p class="flex items-start gap-1.5 text-xs leading-snug text-warning sm:max-lg:text-sm">
    <UIcon name="i-lucide-info" class="mt-px size-3.5 shrink-0 sm:max-lg:mt-0.5 sm:max-lg:size-4" />
    <span>{{ t('social.takenUseAnother') }}</span>
  </p>
</template>
