<script setup lang="ts">
import '~/assets/css/landing.css'

definePageMeta({ layout: 'public' })
useSeoMeta({
  title: 'Planet dhe çmimet · Rrit',
  description:
    'Krahaso paketat e Rrit në euro, numrin e postimeve dhe koston për postim. Zgjidh ritmin e biznesit tënd.',
})
const { capabilities, trialDuration } = useLandingOffer()
const questions = computed(() => [
  {
    label: 'Si funksionon prova falas?',
    content: trialDuration.value
      ? `Bizneset e reja që plotësojnë kushtet kanë ${trialDuration.value} për të provuar shërbimet e aktivizuara. ${capabilities.value?.emailVerificationRequired ? 'Verifiko emailin dhe plotëso' : 'Plotëso'} profilin e biznesit për të filluar. Nuk kërkohet kartë bankare.`
      : 'Disponueshmëria dhe kushtet e provës konfirmohen gjatë regjistrimit.',
  },
  {
    label: 'Çfarë përfshihet në çmim?',
    content:
      'Çmimi është për muajin dhe përfshin postimet e përfitimet e listuara te paketa. Kostoja për postim llogaritet kur përdor të gjithë numrin e postimeve. Me faturim vjetor, shiko edhe totalin për vitin.',
  },
  {
    label: 'A paguaj automatikisht pas provës?',
    content:
      'Jo. Prova nuk kërkon kartë dhe nuk rinovohet automatikisht me pagesë. Të dhënat mbeten të lexueshme dhe të eksportueshme pasi prova përfundon.',
  },
])
</script>

<template>
  <div class="landing landing-pricing-page">
    <section class="landing-pricing-section" aria-labelledby="pricing-page-title">
      <UContainer class="landing-container">
        <div class="landing-section-heading">
          <p class="landing-kicker">BUXHET I QARTË. POSTIM PAS POSTIMI.</p>
          <h1 id="pricing-page-title">Sa postime të duhen?</h1>
          <p>Një paketë për ritmin tënd. Çmimin për çdo postim e sheh menjëherë.</p>
        </div>
        <LandingPricing :show-details-link="false" />
      </UContainer>
    </section>
    <section class="landing-faq-section" aria-labelledby="pricing-faq-title">
      <UContainer class="landing-container landing-faq-layout">
        <div class="landing-faq-intro">
          <p class="landing-kicker">PA PAQARTËSI</p>
          <h2 id="pricing-faq-title">Para se të zgjedhësh.</h2>
          <UButton
            to="/help"
            variant="link"
            color="neutral"
            class="landing-faq-help"
            trailing-icon="i-lucide-arrow-up-right"
            >Ke pyetje tjetër?</UButton
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
