<script setup lang="ts">
import '~/assets/css/landing.css'

definePageMeta({ layout: 'public' })
const { t } = useI18n()
useSeoMeta({
  title: t('pricing.seoTitle'),
  description: t('pricing.seoDescription'),
})
const { capabilities, trialDuration } = useLandingOffer()
const questions = computed(() => [
  {
    label: t('pricing.faqFreeTrial'),
    content: trialDuration.value
      ? t('pricing.faqFreeTrialAvailable', {
          duration: trialDuration.value,
          verification: capabilities.value?.emailVerificationRequired
            ? t('pricing.verifyEmailAndComplete')
            : t('pricing.complete'),
        })
      : t('pricing.faqFreeTrialUnavailable'),
  },
  {
    label: t('pricing.faqIncluded'),
    content: t('pricing.faqIncludedAnswer'),
  },
  {
    label: t('pricing.faqAutomaticPayment'),
    content: t('pricing.faqAutomaticPaymentAnswer'),
  },
])
</script>

<template>
  <div class="landing landing-pricing-page">
    <section class="landing-pricing-section" aria-labelledby="pricing-page-title">
      <UContainer class="landing-container landing-pricing-layout">
        <div class="landing-section-heading landing-section-heading--start">
          <p class="landing-kicker">{{ t('landing.pricingKicker') }}</p>
          <h1 id="pricing-page-title">{{ t('landing.howManyPosts') }}</h1>
          <p>{{ t('landing.packageRhythm') }}</p>
        </div>
        <LandingPackageRequest />
      </UContainer>
    </section>
    <section class="landing-faq-section" aria-labelledby="pricing-faq-title">
      <UContainer class="landing-container landing-faq-layout">
        <div class="landing-faq-intro">
          <p class="landing-kicker">{{ t('legacy.noAmbiguity') }}</p>
          <h2 id="pricing-faq-title">{{ t('legacy.beforeChoosing') }}</h2>
          <UButton
            to="/help"
            variant="link"
            color="neutral"
            class="landing-faq-help"
            trailing-icon="i-lucide-arrow-up-right"
            >{{ t('landing.otherQuestion') }}</UButton
          >
        </div>
        <UAccordion
          :items="questions"
          :ui="{
            item: 'border-0',
            trigger: 'landing-faq-trigger',
            body: 'landing-faq-body',
          }"
        />
      </UContainer>
    </section>
  </div>
</template>
