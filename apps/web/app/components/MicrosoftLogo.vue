<!-- The four-colour Microsoft logo, drawn as Microsoft publishes it. -->
<script setup lang="ts">
import { MICROSOFT_LOGO_COLORS } from '~~/shared/utils/microsoft-logo'

const squares = MICROSOFT_LOGO_COLORS.map((fill, index) => ({ fill, x: index % 2 ? 11 : 1, y: index < 2 ? 1 : 11 }))
</script>
<template>
  <svg viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" class="shrink-0">
    <rect v-for="square in squares" :key="square.fill" :x="square.x" :y="square.y" width="9" height="9" :fill="square.fill" />
  </svg>
</template>
