<script setup lang="ts">
import '~/assets/css/landing.css'

definePageMeta({ layout: 'public' })

const { t } = useI18n()

useSeoMeta({
  title: () => `${t('landing.howManyPosts')} · Framic`,
  robots: 'noindex, nofollow',
})
</script>

<template>
  <div class="landing landing-pricing-page">
    <section class="landing-pricing-section" aria-labelledby="checkout-page-title">
      <UContainer class="landing-container landing-pricing-layout">
        <div class="landing-section-heading landing-section-heading--start">
          <p class="landing-kicker">Framic</p>
          <h1 id="checkout-page-title">{{ t('landing.howManyPosts') }}</h1>
          <p>{{ t('landing.packageRhythm') }}</p>
        </div>
        <UCard class="w-full max-w-md">
          <LandingPackageRequest :show-summary="false" />
        </UCard>
      </UContainer>
    </section>
  </div>
</template>
