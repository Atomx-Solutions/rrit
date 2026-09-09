<script setup lang="ts">
const props = defineProps<{ label: string; caption: string }>()
const scene = ref<HTMLElement>()
const content = ref<HTMLElement>()
const reduced = ref(true)
const paused = ref(false)
const visible = ref(false)
let cleanup: (() => void) | undefined
let frame = 0
let finePointer = false
function resetTilt() {
  cancelAnimationFrame(frame)
  frame = 0
  content.value?.style.removeProperty('--scene-x')
  content.value?.style.removeProperty('--scene-y')
}
function tilt(event: PointerEvent) {
  if (
    reduced.value ||
    paused.value ||
    !visible.value ||
    !finePointer ||
    event.pointerType !== 'mouse'
  )
    return
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const x = Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / bounds.width) * 2 - 1))
  const y = Math.max(-1, Math.min(1, ((event.clientY - bounds.top) / bounds.height) * 2 - 1))
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => {
    content.value?.style.setProperty('--scene-x', `${-y * 4}deg`)
    content.value?.style.setProperty('--scene-y', `${x * 5}deg`)
  })
}
watch(paused, resetTilt)
onMounted(() => {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)')
  const pointer = window.matchMedia('(hover: hover) and (pointer: fine)')
  const sync = () => {
    reduced.value = media.matches
    finePointer = pointer.matches
    if (media.matches || !finePointer) resetTilt()
  }
  sync()
  media.addEventListener('change', sync)
  pointer.addEventListener('change', sync)
  const observer = new IntersectionObserver(([entry]) => {
    visible.value = !!entry?.isIntersecting
    if (!visible.value) resetTilt()
  })
  if (scene.value) observer.observe(scene.value)
  cleanup = () => {
    media.removeEventListener('change', sync)
    pointer.removeEventListener('change', sync)
    observer.disconnect()
    resetTilt()
  }
})
onBeforeUnmount(() => cleanup?.())
</script>
<template>
  <figure
    ref="scene"
    class="landing-feature-scene"
    :class="{ 'is-moving': visible && !reduced && !paused, 'is-animated': !reduced }"
    :aria-label="props.label"
  >
    <div class="landing-scene-stage" @pointermove="tilt" @pointerleave="resetTilt">
      <div ref="content" class="landing-scene-content"><slot /></div>
    </div>
    <figcaption>
      <span>{{ caption }}</span>
      <UButton
        v-if="!reduced"
        :icon="paused ? 'i-lucide-play' : 'i-lucide-pause'"
        :aria-label="`${paused ? 'Vazhdo' : 'Pauzo'} ${label}`"
        :aria-pressed="paused"
        size="xs"
        color="neutral"
        variant="ghost"
        @click="paused = !paused"
      />
    </figcaption>
  </figure>
</template>
