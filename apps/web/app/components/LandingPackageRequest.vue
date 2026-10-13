<script setup lang="ts">
/**
 * Public landing lead form.
 *
 * The visitor says how many posts they need, sees what that costs at the
 * current rate and leaves their details so the team can answer with a real
 * offer. The price is read from the platform setting rather than written into
 * the page, so the figure quoted here is the one the team charges.
 */
const { locale } = useI18n()

const postsRequested = ref(14)
const videosRequested = ref(2)
type PackageRequestOptions = {
  postOptions: number[]
  postPriceCents: number
  videoPriceCents: number
  currency: 'CHF' | 'EUR'
}
const { data: options } = await useFetch<PackageRequestOptions>('/api/package-requests', {
  key: 'package-request-options',
  server: false,
  default: (): PackageRequestOptions => ({ postOptions: [], postPriceCents: 0, videoPriceCents: 0, currency: 'CHF' }),
})
const packagePostPrice = computed(() => (options.value?.postPriceCents || 0) / 100)
const packageVideoPrice = computed(() => (options.value?.videoPriceCents || 0) / 100)
const packageTotal = computed(() =>
  postsRequested.value * packagePostPrice.value + videosRequested.value * packageVideoPrice.value,
)
const money = (value: number) =>
  new Intl.NumberFormat(locale.value, { style: 'currency', currency: options.value?.currency || 'CHF' }).format(value)
</script>

<template>
  <div class="landing-request">
    <div class="landing-package-summary">
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
