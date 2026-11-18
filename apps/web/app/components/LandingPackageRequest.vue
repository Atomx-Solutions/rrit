<script setup lang="ts">
import { DEFAULT_PACKAGE_REQUEST } from '~~/shared/utils/package-defaults'

/** Public lead form. The customer requests volume; the team sends the price. */
const props = withDefaults(defineProps<{ showSummary?: boolean }>(), { showSummary: true })
const postsRequested = ref<number>(DEFAULT_PACKAGE_REQUEST.posts)
const videosRequested = ref<number>(DEFAULT_PACKAGE_REQUEST.videos)
const { t, locale } = useI18n()
// The same request, key and options as PackageRequestForm, so both read one
// response and the summary shows the price the form shows.
const { data: options } = await useFetch<{
  postOptions: number[]
  postPriceCents: number
  videoPriceCents: number
  currency: 'CHF' | 'EUR'
}>('/api/package-requests', { key: 'package-request-form-options', server: false })
const packagePostPrice = computed(() => (options.value?.postPriceCents || 0) / 100)
const packageVideoPrice = computed(() => (options.value?.videoPriceCents || 0) / 100)
const packageTotal = computed(() =>
  postsRequested.value * packagePostPrice.value + videosRequested.value * packageVideoPrice.value)
const money = (value: number) => new Intl.NumberFormat(locale.value, {
  style: 'currency',
  currency: options.value?.currency || 'CHF',
}).format(value)
</script>

<template>
  <div class="landing-request">
    <div v-if="props.showSummary && options" class="landing-package-summary">
      <div class="landing-package-summary-top">
        <div class="landing-package-summary-name">
          <span class="landing-package-eyebrow">{{ t('landing.packageSummaryTitle') }}</span>
          <span class="landing-package-period">{{ t('landing.packagePerMonth', { price: money(packageTotal) }) }}</span>
        </div>
        <span class="landing-package-mark" aria-hidden="true"><UIcon name="i-lucide-panels-top-left" class="size-5" /></span>
      </div>
      <div class="landing-package-breakdown">
        <div class="landing-package-summary-line">
          <span class="landing-package-item"><UIcon name="i-lucide-image" />{{ t('landing.packagePosts', { count: postsRequested }) }}</span>
          <span>{{ t('landing.packagePerPost', { price: money(packagePostPrice) }) }}</span>
        </div>
        <div class="landing-package-summary-line">
          <span class="landing-package-item"><UIcon name="i-lucide-clapperboard" />{{ t('landing.packageVideos', { count: videosRequested }) }}</span>
          <span>{{ t('landing.packagePerVideo', { price: money(packageVideoPrice) }) }}</span>
        </div>
      </div>
    </div>
    <div class="landing-request-form">
      <PackageRequestForm
        v-model:posts="postsRequested"
        v-model:videos="videosRequested"
        compact
        lean
        submit-label-key="landing.leadSubmit"
        :reset-after-sent-ms="10_000"
      />
    </div>
  </div>
</template>
