<script setup lang="ts">
defineProps<{ preview?: boolean }>()
const photo = '/images/tennis-ball-court.jpg'
</script>

<template>
  <div :class="preview ? 'landing-tennis-preview-art' : 'landing-tennis-ground landing-depth-item'">
    <img
      class="landing-tennis-photo"
      :class="{ 'landing-depth-item': !preview }"
      :src="photo"
      :alt="preview ? '' : 'Fotografi reale e një topi tenisi, me hijen e tij mbi vijat e fushës'"
      width="1000"
      height="1500"
      loading="eager"
      decoding="async"
    />
    <div class="landing-tennis-copy" :class="{ 'landing-depth-item': !preview }">
      <span>TENIS / PAS PUNE</span>
      <p>NË FUSHË.<br /><em>PAS PUNE.</em></p>
    </div>
    <div class="landing-tennis-signature" :class="{ 'landing-depth-item': !preview }">
      <span>Më shumë lojë.<br />Më pak rutinë.</span>
    </div>
  </div>
</template>
