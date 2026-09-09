<script setup lang="ts">
import '~/assets/css/landing.css'
import '~/assets/css/landing-scenes.css'
import { formatMoney } from '~~/shared/utils/format'
definePageMeta({ layout: 'public' })
const landingRoot = ref<HTMLElement>()
useLandingMotion(landingRoot)
const { capabilities, trialDuration, trialLabel, canRegister, refresh } = useLandingOffer()
const { plans, error } = usePlanCatalog()
const startingPlan = computed(() =>
  error.value ? undefined : [...plans.value].sort((a, b) => a.price - b.price)[0],
)
useSeoMeta({
  title: 'Rrit — Postime që bien në sy.',
  description:
    'Përgatit, mirato dhe planifiko postimet në shqip. Plane në euro për bizneset në Kosovë.',
  ogTitle: 'Biznesi yt meriton të shihet. Rrit.',
  ogDescription: 'Më pak kohë me postimet. Më shumë me biznesin.',
  ogType: 'website',
})
const questions = computed(() => [
  {
    label: 'Si filloj?',
    content:
      'Krijo llogarinë, na trego për biznesin dhe shto fotografinë e parë. Regjistrimi të udhëzon në shqip. Facebook dhe Instagram mund t’i lidhësh më vonë.',
  },
  {
    label: 'A publikohen postimet vetë?',
    content: capabilities.value?.publishing
      ? 'Vetëm pas miratimit tënd dhe në orarin që zgjedh. Publikimi kërkon llogari të lidhura dhe leje aktive.'
      : 'Publikimi automatik ende nuk është aktiv. Tani mund t’i përgatitësh, miratosh dhe planifikosh postimet, pastaj t’i publikosh manualisht.',
  },
  {
    label: 'Çfarë ndodh pas provës?',
    content: trialDuration.value
      ? `Ke ${trialDuration.value} për shërbimet e aktivizuara, sipas kushteve të provës. Nuk kërkohet kartë dhe nuk ka pagesë automatike. Kur prova mbaron, të dhënat mbeten të lexueshme dhe të eksportueshme.`
      : 'Disponueshmëria e provës konfirmohet gjatë regjistrimit. Nuk kërkohet kartë dhe nuk ka pagesë automatike.',
  },
])
</script>
<template>
  <div ref="landingRoot" class="landing">
    <section class="landing-hero" aria-labelledby="hero-title">
      <UContainer class="landing-container landing-hero-grid">
        <div class="landing-hero-copy">
          <p class="landing-kicker">
            <span class="landing-live-dot" /> PËR BIZNESET QË KANË ÇFARË TË TREGOJNË
          </p>
          <h1 id="hero-title">Postime që<br /><span>bien në sy.</span></h1>
          <p class="landing-hero-description">
            Ti ke biznesin për të mbajtur.<br />Jepu postimeve më pak nga dita jote.
          </p>
          <p class="landing-hero-detail">
            Përgatit, mirato dhe planifiko për Facebook e Instagram. Në një vend. Në shqip.
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
              >Kontrollo regjistrimin</UButton
            >
            <UButton to="#cmimet" variant="link" color="neutral" size="lg">Shiko paketat</UButton>
          </div>
          <p v-if="canRegister" class="landing-smallprint">
            Pa kartë bankare.<template v-if="startingPlan">
              Nga {{ formatMoney(startingPlan.price) }}/muaj.</template
            >
          </p>
          <p v-else class="landing-smallprint" role="status">
            Regjistrimi nuk u konfirmua. Provo sërish pas pak.
          </p>
        </div>
        <LandingPostShowcase />
      </UContainer>
    </section>
    <section id="perse" class="landing-process" aria-label="Çfarë bën me Rrit">
      <UContainer class="landing-container">
        <div class="landing-process-inner">
          <p>Gjithë muaji.<br /><strong>Nën kontroll.</strong></p>
          <ol>
            <li>
              <span>01</span><UIcon name="i-lucide-image-plus" /><strong>Foto & tekst</strong>
            </li>
            <li>
              <span>02</span><UIcon name="i-lucide-circle-check" /><strong>Miratimi yt</strong>
            </li>
            <li>
              <span>03</span><UIcon name="i-lucide-calendar-days" /><strong>Në kalendar</strong>
            </li>
          </ol>
        </div>
      </UContainer>
    </section>
    <LandingStories />
    <section id="cmimet" class="landing-pricing-section" aria-labelledby="pricing-title">
      <UContainer class="landing-container">
        <div class="landing-section-heading">
          <p class="landing-kicker">BUXHET I QARTË. POSTIM PAS POSTIMI.</p>
          <h2 id="pricing-title">Sa postime të duhen?</h2>
          <p>Një paketë për ritmin tënd. Çmimin për çdo postim e sheh menjëherë.</p>
        </div>
        <LandingPricing />
      </UContainer>
    </section>
    <section id="pyetje" class="landing-faq-section" aria-labelledby="faq-title">
      <UContainer class="landing-container">
        <div class="landing-faq-layout">
          <div class="landing-faq-intro">
            <p class="landing-kicker">MIRË TA DISH</p>
            <h2 id="faq-title">Para se<br /><span>të nisësh.</span></h2>
            <p class="landing-faq-description">Pak qartësi për hapin e parë.</p>
            <UButton
              to="/help"
              variant="link"
              color="neutral"
              class="landing-faq-help"
              trailing-icon="i-lucide-arrow-up-right"
              >Ke pyetje tjetër?</UButton
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
          <p class="landing-kicker">POSTIMI YT I RADHËS</p>
          <h2 id="closing-title">Tash, le të <span>të shohin.</span></h2>
          <p class="landing-final-description">
            Biznesi yt ka historinë. Jepi një vend në postimin e radhës.
          </p>
        </div>
        <div class="landing-final-next">
          <UButton
            :to="canRegister ? '/signup' : '/help'"
            size="xl"
            variant="link"
            class="landing-final-action"
          >
            {{ canRegister ? trialLabel : 'Shiko si funksionon' }}
            <template #trailing>
              <span class="landing-final-arrow" aria-hidden="true">
                <UIcon name="i-lucide-arrow-up-right" />
              </span>
            </template>
          </UButton>
          <p v-if="canRegister" class="landing-final-note">Në shqip. Pa kartë bankare.</p>
        </div>
      </section>
    </UContainer>
  </div>
</template>
