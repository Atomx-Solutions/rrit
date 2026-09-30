<script setup lang="ts">
/**
 * Public landing estimator. The visitor picks a monthly post volume as
 * intent only — the real request is placed after signup, so the section
 * carries no personal fields and posts nothing. The dot grid maps the
 * chosen count onto a 30-day month so the choice reads at a glance.
 */
const { t } = useI18n()

const postsRequested = ref(20)
const { data: options } = await useFetch<{ postOptions: number[] }>('/api/package-requests', {
  key: 'package-request-options',
  server: false,
  default: () => ({ postOptions: [] }),
})
const postOptions = computed(() => options.value?.postOptions || [])
const signupHref = computed(() => `/signup?posts=${postsRequested.value}`)
const perWeek = computed(() => (postsRequested.value / 30 * 7).toFixed(1).replace(/\.0$/, ''))
const dotCount = 30
const filledDays = computed(() => {
  const posts = Math.max(0, Math.min(dotCount, postsRequested.value))
  const step = dotCount / posts
  return new Set(Array.from({ length: posts }, (_, i) => Math.floor(i * step)))
})
</script>

<template>
  <div class="landing-request">
    <div class="landing-request-hero">
      <span class="landing-request-count">{{ postsRequested }}</span>
      <div class="landing-request-hero-meta">
        <span class="landing-request-hero-label">{{ t('request.posts') }}</span>
        <span class="landing-request-hero-sub">≈ {{ perWeek }} / javë</span>
      </div>
    </div>

    <div class="landing-request-grid" aria-hidden="true">
      <span
        v-for="i in dotCount"
        :key="i"
        class="landing-request-dot"
        :class="{ 'is-on': filledDays.has(i - 1) }"
      />
    </div>

    <div v-if="postOptions.length" class="landing-request-chips">
      <UButton
        v-for="amount in postOptions"
        :key="amount"
        size="sm"
        :color="postsRequested === amount ? 'primary' : 'neutral'"
        :variant="postsRequested === amount ? 'solid' : 'outline'"
        :aria-pressed="postsRequested === amount"
        :label="String(amount)"
        @click="postsRequested = amount"
      />
    </div>
    <UInputNumber v-model="postsRequested" :min="1" :max="1000" class="w-full" />

    <UButton
      :to="signupHref"
      trailing-icon="i-lucide-arrow-up-right"
      :label="t('landing.requestOffer')"
      block
      class="mt-4"
    />
  </div>
</template>
