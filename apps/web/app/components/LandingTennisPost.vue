<script setup lang="ts">
const { t } = useI18n()
defineProps<{ preview?: boolean }>()
const photo = '/images/tennis-ball-court-small.webp'
</script>

<template>
  <div :class="preview ? 'landing-tennis-preview-art' : 'landing-tennis-ground landing-depth-item'">
    <img
      class="landing-tennis-photo"
      :class="{ 'landing-depth-item': !preview }"
      :src="photo"
      :alt="preview ? '' : t('landing.tennisPhotoAlt')"
      width="420"
      height="630"
      :loading="preview ? 'lazy' : 'eager'"
      decoding="async"
    />
    <div class="landing-tennis-copy" :class="{ 'landing-depth-item': !preview }">
      <span>{{ t('legacy.tennisAfterWork') }}</span>
      <p>{{ t('legacy.onCourtUpper') }}<br /><em>{{ t('legacy.afterWorkUpper') }}</em></p>
    </div>
    <div class="landing-tennis-signature" :class="{ 'landing-depth-item': !preview }">
      <span>{{ t('legacy.morePlay') }}<br />{{ t('legacy.lessRoutine') }}</span>
    </div>
  </div>
</template>
