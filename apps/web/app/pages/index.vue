<script setup lang="ts">
import '~/assets/css/landing.css'
import '~/assets/css/landing-scenes.css'
import { formatMoney } from '~~/shared/utils/format'
definePageMeta({ layout: 'public' })
const landingRoot = ref<HTMLElement>()
useLandingMotion(landingRoot)
const { t } = useI18n()
const { capabilities, trialDuration, trialLabel, canRegister, refresh } = useLandingOffer()
const { plans, error } = usePlanCatalog()
const startingPlan = computed(() =>
  error.value ? undefined : [...plans.value].sort((a, b) => a.price - b.price)[0],
)
useSeoMeta({
  title: t('landing.seoTitle'),
  description: t('landing.seoDescription'),
  ogTitle: t('landing.ogTitle'),
  ogDescription: t('landing.ogDescription'),
  ogType: 'website',
})
const questions = computed(() => [
  {
    label: t('landing.faqStart'),
    content: t('landing.faqStartAnswer'),
  },
  {
    label: t('landing.faqAutoPublish'),
    content: capabilities.value?.publishing
      ? t('landing.faqAutoPublishEnabled')
      : t('landing.faqAutoPublishDisabled'),
  },
  {
    label: t('landing.faqAfterTrial'),
    content: trialDuration.value
      ? t('landing.faqAfterTrialAvailable', { duration: trialDuration.value })
      : t('landing.faqAfterTrialUnavailable'),
  },
])
</script>
<template>
  <div ref="landingRoot" class="landing">
    <section class="landing-hero" aria-labelledby="hero-title">
      <UContainer class="landing-container landing-hero-grid">
        <div class="landing-hero-copy">
          <p class="landing-kicker">
            <span class="landing-live-dot" /> {{ t('landing.heroKicker') }}
          </p>
          <h1 id="hero-title">{{ t('legacy.posts') }}<br /><span>{{ t('legacy.standOut') }}</span></h1>
          <p class="landing-hero-description">
            {{ t('landing.heroDescription') }}
          </p>
          <p class="landing-hero-detail">
            {{ t('landing.heroDetail') }}
          </p>
          <div class="landing-button-row">
            <UButton
              v-if="canRegister"
              to="/signup"
              size="xl"
              trailing-icon="i-lucide-arrow-up-right"
              class="landing-primary-button"
              >{{ trialLabel }}</UButton
            >
            <UButton
              v-else
              size="xl"
              variant="outline"
              color="neutral"
              icon="i-lucide-refresh-cw"
              @click="refresh()"
              >{{ t('landing.checkRegistration') }}</UButton
            >
            <UButton to="#cmimet" variant="link" color="neutral" size="lg">{{
              t('landing.viewPackages')
            }}</UButton>
          </div>
          <p v-if="canRegister" class="landing-smallprint">
            {{ t('landing.noCard') }}<template v-if="startingPlan">
              {{ t('landing.fromPrice', { price: formatMoney(startingPlan.price) }) }}</template
            >
          </p>
          <p v-else class="landing-smallprint" role="status">
            {{ t('landing.registrationUnavailable') }}
          </p>
        </div>
        <LandingPostShowcase />
      </UContainer>
    </section>
    <section id="perse" class="landing-process" :aria-label="t('landing.processAria')">
      <UContainer class="landing-container">
        <div class="landing-process-inner">
          <p>{{ t('landing.allMonth') }}<br /><strong>{{ t('landing.underControl') }}</strong></p>
          <ol>
            <li>
              <span>01</span><UIcon name="i-lucide-image-plus" /><strong>{{ t('landing.photoText') }}</strong>
            </li>
            <li>
              <span>02</span><UIcon name="i-lucide-circle-check" /><strong>{{ t('landing.yourApproval') }}</strong>
            </li>
            <li>
              <span>03</span><UIcon name="i-lucide-calendar-days" /><strong>{{ t('landing.inCalendar') }}</strong>
            </li>
          </ol>
        </div>
      </UContainer>
    </section>
    <LandingStories />
    <section id="cmimet" class="landing-pricing-section" aria-labelledby="pricing-title">
      <UContainer class="landing-container">
        <div class="landing-section-heading">
          <p class="landing-kicker">{{ t('landing.pricingKicker') }}</p>
          <h2 id="pricing-title">{{ t('landing.howManyPosts') }}</h2>
          <p>{{ t('landing.packageRhythm') }}</p>
        </div>
        <LandingPricing />
      </UContainer>
    </section>
    <section id="pyetje" class="landing-faq-section" aria-labelledby="faq-title">
      <UContainer class="landing-container">
        <div class="landing-faq-layout">
          <div class="landing-faq-intro">
            <p class="landing-kicker">{{ t('landing.goodToKnow') }}</p>
            <h2 id="faq-title">{{ t('landing.beforeStart') }}</h2>
            <p class="landing-faq-description">{{ t('landing.firstStepClarity') }}</p>
            <UButton
              to="/help"
              variant="link"
              color="neutral"
              class="landing-faq-help"
              trailing-icon="i-lucide-arrow-up-right"
              >{{ t('landing.otherQuestion') }}</UButton
            >
          </div>
          <div class="landing-faq-answers">
            <UAccordion
              :items="questions"
              trailing-icon="i-lucide-plus"
              :ui="{
                root: 'landing-faq-accordion',
                item: 'landing-faq-item',
                trigger: 'landing-faq-trigger',
                trailingIcon: 'landing-faq-toggle',
                body: 'landing-faq-body',
              }"
            >
              <template #leading="{ index }"
                ><span class="landing-faq-number" aria-hidden="true"
                  >0{{ index + 1 }}</span
                ></template
              >
            </UAccordion>
          </div>
        </div>
      </UContainer>
    </section>
    <UContainer class="landing-container">
      <section class="landing-final" aria-labelledby="closing-title">
        <div class="landing-final-copy">
          <p class="landing-kicker">{{ t('landing.yourNextPost') }}</p>
          <h2 id="closing-title">{{ t('landing.letThemSee') }}</h2>
          <p class="landing-final-description">{{ t('landing.finalDescription') }}</p>
        </div>
        <div class="landing-final-next">
          <UButton
            :to="canRegister ? '/signup' : '/help'"
            size="xl"
            variant="link"
            class="landing-final-action"
          >
            {{ canRegister ? trialLabel : t('landing.seeHowItWorks') }}
            <template #trailing>
              <span class="landing-final-arrow" aria-hidden="true">
                <UIcon name="i-lucide-arrow-up-right" />
              </span>
            </template>
          </UButton>
          <p v-if="canRegister" class="landing-final-note">{{ t('landing.albanianNoCard') }}</p>
        </div>
      </section>
    </UContainer>
  </div>
</template>
