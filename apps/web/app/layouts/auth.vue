<script setup lang="ts">
const { t } = useI18n()
const story = ref<HTMLElement>()
const form = ref<HTMLElement>()
// On narrow screens the story stacks above the form; glide down to the form
// so the person lands where they act, while still seeing there is more above.
// The short wait lets the router finish resetting the scroll to the top.
onMounted(() => {
  if (!story.value || !form.value) return
  if (form.value.offsetTop < story.value.offsetTop + story.value.offsetHeight) return
  setTimeout(() => form.value && glideTo(form.value.getBoundingClientRect().top + window.scrollY), 250)
})
// Drawn frame by frame: native smooth scrolling is skipped by some browsers.
function glideTo(target: number) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return window.scrollTo(0, target)
  const start = window.scrollY
  const began = performance.now()
  const duration = 700
  const step = (now: number) => {
    const progress = Math.min((now - began) / duration, 1)
    const eased = 1 - (1 - progress) ** 3
    window.scrollTo(0, start + (target - start) * eased)
    if (progress < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}
</script>

<template>
  <div class="auth-layout">
    <aside ref="story" class="auth-story">
      <BrandLogo />
      <div class="auth-story-content">
        <span class="eyebrow">{{ t('public.skipBusiness') }}</span>
        <h2 class="mt-5">{{ t('public.everyDay') }}<br />{{ t('public.growOpportunity') }}</h2>
        <p>{{ t('public.businessPosts') }}</p>
        <img
          src="/images/table.jpg"
          :alt="t('dashboard.coffeeAlt')"
          width="440"
          height="230"
          class="auth-story-image mt-8"
        />
      </div>
    </aside>
    <main ref="form" class="auth-form">
      <UButton
        to="/"
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="soft"
        size="sm"
        class="mb-8 rounded-full"
        >{{ t('public.backToFramic') }}</UButton
      ><slot />
    </main>
  </div>
</template>
