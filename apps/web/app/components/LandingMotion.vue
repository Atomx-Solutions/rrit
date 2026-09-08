<script setup lang="ts">
import { motion, useReducedMotion } from 'motion-v'
const reduced = useReducedMotion()
</script>
<template>
  <motion.div
    :initial="{ opacity: 1, y: reduced ? 0 : 12 }"
    :while-in-view="{ opacity: 1, y: 0 }"
    :transition="{ duration: reduced ? 0 : 0.4 }"
    :in-view-options="{ once: true }"
    ><slot
  /></motion.div>
</template>
