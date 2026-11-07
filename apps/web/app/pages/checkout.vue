<script setup lang="ts">
import '~/assets/css/landing.css'

definePageMeta({ layout: 'public' })

const { t } = useI18n()
const runtimeConfig = useRuntimeConfig()

useHead({ script: [{ src: 'https://cdn.paddle.com/paddle/v2/paddle.js', defer: true }] })

let paddleTimer: number | undefined
onMounted(() => {
  const token = String(runtimeConfig.public.paddleClientToken || '')
  if (!token) return

  let attempts = 0
  paddleTimer = window.setInterval(() => {
    const paddle = (window as typeof window & { Paddle?: {
      Environment: { set: (environment: 'sandbox') => void }
      Initialize: (options: { token: string }) => void
    } }).Paddle
    if (!paddle && attempts++ < 100) return
    window.clearInterval(paddleTimer)
    if (!paddle) return
    if (runtimeConfig.public.paddleEnvironment === 'sandbox') paddle.Environment.set('sandbox')
    paddle.Initialize({ token })
  }, 100)
})
onUnmounted(() => window.clearInterval(paddleTimer))

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
