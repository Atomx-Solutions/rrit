<script setup lang="ts">
/**
 * Public landing lead form.
 *
 * The visitor says how many posts they need, sees what that costs at the
 * current rate and leaves their details so the team can answer with a real
 * offer. The price is read from the platform setting rather than written into
 * the page, so the figure quoted here is the one the team charges.
 */
const { locale, t } = useI18n()

const postsRequested = ref(20)
const { data: options } = await useFetch<{ postPriceCents: number }>('/api/package-requests', {
  key: 'package-request-options',
  server: false,
  // Keep the payload shape identical to PackageRequestForm because both
  // components intentionally share this useFetch key.
  default: () => ({ postOptions: [], postPriceCents: 0 }),
})
const postPrice = computed(() => (options.value?.postPriceCents || 0) / 100)
const estimatedTotal = computed(() => postPrice.value * postsRequested.value)
const money = (value: number) =>
  new Intl.NumberFormat(locale.value, { style: 'currency', currency: 'CHF' }).format(value)
</script>

<template>
  <div class="landing-request">
    <!-- The price before the form, not after it: nobody should have to hand
         over a phone number to learn what a post costs. -->
    <!-- The rate first, because it is the fact; the total is what it adds up
         to for the volume chosen. Both read at the same weight so neither is
         sold as the headline. -->
    <p v-if="postPrice > 0" class="landing-request-price">
      <span class="landing-request-price-rate">
        {{ t('landing.perPostPrice', { price: money(postPrice) }) }}
      </span>
      <span class="landing-request-price-total">
        {{ t('landing.monthlyTotal', { price: money(estimatedTotal) }) }}
      </span>
    </p>

    <div class="landing-request-form">
      <PackageRequestForm
        v-model:posts="postsRequested"
        compact
        lean
        submit-label-key="landing.leadSubmit"
        :reset-after-sent-ms="10_000"
      />
    </div>
  </div>
</template>
