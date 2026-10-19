<script setup lang="ts">
import { DEFAULT_PACKAGE_REQUEST } from '~~/shared/utils/package-defaults'

/** Public lead form. The customer requests volume; the team sends the price. */
const props = withDefaults(defineProps<{ showSummary?: boolean }>(), { showSummary: true })
const postsRequested = ref<number>(DEFAULT_PACKAGE_REQUEST.posts)
const videosRequested = ref<number>(DEFAULT_PACKAGE_REQUEST.videos)
const { locale } = useI18n()
const landingCurrency = 'CHF' as const
const packagePostPrice = 5.35
const packageVideoPrice = 12.05
const packageTotal = computed(() => postsRequested.value * packagePostPrice + videosRequested.value * packageVideoPrice)
const money = (value: number) => new Intl.NumberFormat(locale.value, { style: 'currency', currency: landingCurrency }).format(value)
</script>

<template>
  <div class="landing-request">
    <div v-if="props.showSummary" class="landing-package-summary">
      <div class="landing-package-summary-top">
        <strong>Framic Content Paket</strong>
        <strong>{{ money(packageTotal) }} / Monat</strong>
      </div>
      <div class="landing-package-summary-line">
        <span>{{ postsRequested }} Posts</span>
        <span>{{ money(packagePostPrice) }} pro Post</span>
      </div>
      <div class="landing-package-summary-line">
        <span>{{ videosRequested }} Videos</span>
        <span>{{ money(packageVideoPrice) }} pro Video</span>
      </div>
      <div class="landing-package-summary-total">
        <span>Gesamt</span>
        <strong>{{ money(packageTotal) }}</strong>
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
