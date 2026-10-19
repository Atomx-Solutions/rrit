<script setup lang="ts">
import '~/assets/css/landing.css'

definePageMeta({ layout: 'public' })

const { t } = useI18n()
const config = useRuntimeConfig()
const loading = ref(false)
const error = ref('')

type PaddleCheckout = { open: (options: { items: Array<{ priceId: string; quantity: number }> }) => void }
type PaddleApi = { Initialize: (options: { token: string }) => void; Environment: { set: (environment: 'sandbox' | 'production') => void }; Checkout: PaddleCheckout }
declare global { interface Window { Paddle?: PaddleApi } }

useHead({
  script: [{ src: 'https://cdn.paddle.com/paddle/v2/paddle.js', defer: true }],
})

function openCheckout() {
  error.value = ''
  const token = String(config.public.paddleClientToken || '')
  const priceId = String(config.public.paddlePackagePriceId || '')
  if (!token || !priceId) {
    error.value = 'Paddle checkout nuk është konfiguruar ende.'
    return
  }
  if (!window.Paddle) {
    error.value = 'Paddle po ngarkohet. Provo përsëri pas pak.'
    return
  }
  loading.value = true
  if (config.public.paddleEnvironment === 'sandbox') window.Paddle.Environment.set('sandbox')
  window.Paddle.Initialize({ token })
  window.Paddle.Checkout.open({ items: [{ priceId, quantity: 1 }] })
  loading.value = false
}

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
          <template #header>
            <div class="flex items-center justify-between gap-4">
              <h2 class="font-semibold">Framic Content Package</h2>
              <span class="text-lg font-bold text-primary">99 CHF / muaj</span>
            </div>
          </template>
          <div class="space-y-4">
            <ul class="space-y-2 text-sm text-muted">
              <li>14 posts në muaj</li>
              <li>2 video posts në muaj</li>
            </ul>
            <UAlert v-if="error" color="error" variant="subtle" :description="error" />
            <UButton block color="primary" :loading="loading" @click="openCheckout">
              Vazhdo te pagesa
            </UButton>
          </div>
        </UCard>
      </UContainer>
    </section>
  </div>
</template>
