<!-- The Instagram logo with its own gradient, as Meta publishes it. -->
<script setup lang="ts">
// Each logo on a page needs its own gradient id.
const id = useId()
</script>
<template>
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" class="shrink-0">
    <defs>
      <radialGradient :id="id" cx="0.3" cy="1.07" r="1.1">
        <stop offset="0" stop-color="#FFDD55" />
        <stop offset="0.1" stop-color="#FFDD55" />
        <stop offset="0.5" stop-color="#FF543E" />
        <stop offset="1" stop-color="#C837AB" />
      </radialGradient>
    </defs>
    <rect width="24" height="24" rx="6" :fill="`url(#${id})`" />
    <rect x="5" y="5" width="14" height="14" rx="4" fill="none" stroke="#FFFFFF" stroke-width="1.8" />
    <circle cx="12" cy="12" r="3.3" fill="none" stroke="#FFFFFF" stroke-width="1.8" />
    <circle cx="16.4" cy="7.6" r="1.05" fill="#FFFFFF" />
  </svg>
</template>
