<script setup lang="ts">
const { t } = useI18n()
const stage = ref<HTMLElement>()
const reduced = ref(true)
const paused = ref(false)
const visible = ref(true)
const photos = {
  coffee: '/images/table.jpg',
  burger: '/images/burger.jpg',
  space: '/images/interior.jpg',
}
let cleanup: (() => void) | undefined
onMounted(() => {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)')
  const sync = () => {
    reduced.value = media.matches
  }
  sync()
  media.addEventListener('change', sync)
  const observer = new IntersectionObserver(([entry]) => {
    visible.value = !!entry?.isIntersecting
  })
  if (stage.value) observer.observe(stage.value)
  cleanup = () => {
    media.removeEventListener('change', sync)
    observer.disconnect()
  }
})
onBeforeUnmount(() => cleanup?.())
const moving = computed(() => !reduced.value && !paused.value && visible.value)
</script>
<template>
  <figure
    ref="stage"
    class="landing-showcase"
    :class="{ 'is-moving': moving, 'is-reduced': reduced }"
    aria-labelledby="showcase-caption"
  >
    <div class="landing-orbit" aria-hidden="true">
      <div class="landing-orbit-ring" />
      <div class="landing-orbit-ring second" />
      <div class="landing-glass-sphere" />
    </div>
    <div class="landing-post-deck">
      <UCard class="landing-design-post landing-post-coffee" :ui="{ body: 'p-0 sm:p-0 h-full' }">
        <div class="poster poster-coffee">
          <div class="poster-brand">
            <span>{{ t('legacy.coffeeSocial') }}</span><UIcon name="i-lucide-sun" aria-hidden="true" />
          </div>
          <p class="poster-coffee-title">{{ t('legacy.satisfy') }}<br /><span>{{ t('legacy.day') }}</span></p>
          <div class="poster-coffee-photo">
            <img
              :src="photos.coffee"
              :alt="t('landing.coffeeAlt')"
              width="1000"
              height="667"
              fetchpriority="high"
            />
          </div>
          <p class="poster-footer">{{ t('legacy.goodCoffee') }}</p>
        </div>
      </UCard>
      <UCard class="landing-design-post landing-post-food" :ui="{ body: 'p-0 sm:p-0 h-full' }">
        <div class="poster poster-food">
          <div class="poster-brand"><span>{{ t('legacy.burgerHouse') }}</span><span>{{ t('legacy.prishtina') }}</span></div>
          <p class="poster-food-title">{{ t('legacy.fewWords') }}<br /><span>{{ t('legacy.muchTaste') }}</span></p>
          <div class="poster-food-photo">
            <img
              :src="photos.burger"
              :alt="t('landing.burgerAlt')"
              width="900"
              height="748"
              decoding="async"
            />
          </div>
          <div class="poster-food-stamp" aria-hidden="true">{{ t('legacy.make') }}<br />{{ t('legacy.break') }}</div>
          <p class="poster-footer">{{ t('legacy.tastyMoment') }}</p>
        </div>
      </UCard>
      <UCard class="landing-design-post landing-post-space" :ui="{ body: 'p-0 sm:p-0 h-full' }">
        <div class="poster poster-space">
          <img
            :src="photos.space"
            :alt="t('landing.spaceAlt')"
            width="1000"
            height="667"
            decoding="async"
          />
          <div class="poster-space-copy">
            <div class="poster-brand"><span>{{ t('legacy.spaceForYou') }}</span><span>↗</span></div>
            <p class="poster-space-title">{{ t('legacy.stay') }}<br /><em>{{ t('legacy.aLittle') }}</em></p>
            <p class="poster-space-bottom">{{ t('legacy.somePlaces') }}<br />{{ t('legacy.makeYouStop') }}</p>
          </div>
        </div>
      </UCard>
    </div>
    <figcaption id="showcase-caption">
      <span>{{ t('legacy.illustrativeDesigns') }}</span>
      <UButton
        v-if="!reduced"
        :icon="paused ? 'i-lucide-play' : 'i-lucide-pause'"
        :aria-label="paused ? t('landing.resumeAnimation') : t('landing.pauseAnimation')"
        :aria-pressed="paused"
        size="xs"
        color="neutral"
        variant="ghost"
        @click="paused = !paused"
      />
    </figcaption>
  </figure>
</template>
