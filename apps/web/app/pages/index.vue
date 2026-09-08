<script setup lang="ts">
import { formatMoney } from '~~/shared/utils/format'
const { plans } = usePlanCatalog()
const { data: capabilities } = await useFetch('/api/capabilities')
definePageMeta({ layout: 'public' })
useSeoMeta({
  title: 'Rrit — Postimet e biznesit, më thjesht',
  description:
    'Një hapësirë e thjeshtë në shqip për të përgatitur, kontrolluar dhe planifikuar postimet e biznesit. Për bizneset në Kosovë.',
  ogTitle: 'Rrit — Postimet e biznesit, më thjesht',
  ogType: 'website',
})
const steps = [
  {
    number: '01',
    icon: 'i-lucide-store',
    title: 'Na njofto me biznesin',
    description: 'Trego çfarë ofron dhe si dëshiron të flasësh me klientët. Me fjalët e tua.',
  },
  {
    number: '02',
    icon: 'i-lucide-image-plus',
    title: 'Përgatit postimin',
    description: 'Zgjidh një fotografi dhe shkruaj mesazhin. Drafti ruhet gjatë punës.',
  },
  {
    number: '03',
    icon: 'i-lucide-check-check',
    title: 'Kontrollo dhe planifiko',
    description: 'Lexoje edhe një herë, jep miratimin dhe zgjidh ditën në kalendar.',
  },
]
const questions = computed(() => [
  {
    label: 'A duhet të kem njohuri për marketing?',
    content:
      'Jo. Fillo me emrin e biznesit, një përshkrim të shkurtër dhe një fotografi. Hapat dhe udhëzimet janë në shqip.',
  },
  {
    label: 'A mund ta ndryshoj postimin para miratimit?',
    content:
      'Po. Mund ta ndryshosh tekstin dhe fotografinë, ta ruash si draft dhe të kthehesh më vonë. Fjala e fundit mbetet e jotja.',
  },
  {
    label: 'A lidhen tani Facebook dhe Instagram?',
    content: capabilities.value?.socialImport
      ? 'Po. Lidh llogarinë tënde përmes Meta, zgjidh faqen e biznesit dhe lexo postimet. Për Instagram kërkohet profil profesional i lidhur me atë faqe.'
      : 'Lidhja me Meta është në përgatitje nga platforma. Ndërkohë, mund të regjistrosh biznesin dhe të përgatitësh postime.',
  },
  {
    label: 'Si funksionon trial-i falas?',
    content: capabilities.value?.trialHours
      ? `Pas krijimit të biznesit, përdoruesit e rinj që plotësojnë kushtet marrin ${capabilities.value.trialHours / 24} ditë falas. Pa kartë dhe pa rinovim automatik.`
      : 'Periudha falas shfaqet gjatë regjistrimit. Nuk kërkohet kartë bankare.',
  },
])
</script>
<template>
  <div class="bg-default">
    <UPageHero
      :ui="{
        container: 'pt-14 pb-12 sm:pt-20 sm:pb-16 lg:pt-20 lg:pb-16 gap-10 sm:gap-14',
        title: 'text-5xl sm:text-6xl lg:text-7xl leading-[1.06] tracking-[-.045em] font-semibold',
        description: 'text-base sm:text-lg leading-relaxed max-w-xl mx-auto text-muted',
        links: 'gap-3',
      }"
    >
      <template #headline
        ><div class="inline-flex items-center gap-2 text-xs font-medium text-muted">
          <span class="size-1.5 rounded-full bg-primary" />Për bizneset në Kosovë<USeparator
            orientation="vertical"
            class="h-3 mx-1"
          />Në shqip
        </div></template
      >
      <template #title
        >Postimet e tua.<br /><span class="text-primary">Një punë më pak.</span></template
      >
      <template #description
        >Idetë, fotografitë dhe postimet e biznesit, në një vend të qartë. Përgatiti me qetësi.
        Ndryshoji kur të duash. Miratoji vetë.</template
      >
      <template #links
        ><UButton to="/signup" size="xl" variant="outline" trailing-icon="i-lucide-arrow-right"
          >Fillo falas</UButton
        ><UButton to="/onboarding" size="xl" color="neutral" variant="ghost"
          >Nis me biznesin tënd</UButton
        ></template
      >
      <template #body
        ><p class="text-xs text-muted mt-2">
          {{
            capabilities?.trialHours ? capabilities.trialHours / 24 + ' ditë trial falas · ' : ''
          }}Pa kartë bankare
        </p></template
      >
      <LandingProductPreview />
    </UPageHero>

    <UContainer
      ><div
        class="flex flex-wrap justify-center items-center gap-x-8 gap-y-3 text-sm text-muted pb-14 sm:pb-20"
      >
        <span class="inline-flex gap-2 items-center"
          ><UIcon name="i-lucide-facebook" class="size-4" />Facebook</span
        ><span class="inline-flex gap-2 items-center"
          ><UIcon name="i-lucide-instagram" class="size-4" />Instagram</span
        ><span class="hidden sm:block w-px h-4 bg-border" /><span
          >Për kafenetë, dyqanet dhe shërbimet e lagjes.</span
        >
      </div></UContainer
    >

    <div class="border-y border-default bg-elevated/25">
      <UPageSection
        id="features"
        orientation="horizontal"
        title="Biznesi yt ka çfarë të tregojë."
        description="Një produkt i ri. Një detaj nga puna. Një moment i zakonshëm. Postimi i radhës shpesh është tashmë aty."
        :ui="{
          container: 'py-14 sm:py-20 lg:py-24 gap-10 lg:gap-16',
          title: 'text-3xl sm:text-4xl leading-tight tracking-tight',
          description: 'text-base leading-relaxed text-muted',
        }"
      >
        <template #body>
          <div class="space-y-5 mt-2">
            <div class="flex gap-3">
              <UIcon name="i-lucide-folder-open" class="size-5 text-primary shrink-0 mt-0.5" />
              <div>
                <h3 class="text-sm font-semibold">Fotografitë bashkë</h3>
                <p class="text-sm text-muted mt-1">
                  Gjej fotografinë e duhur, pa kërkuar nëpër biseda.
                </p>
              </div>
            </div>
            <div class="flex gap-3">
              <UIcon name="i-lucide-pencil-line" class="size-5 text-primary shrink-0 mt-0.5" />
              <div>
                <h3 class="text-sm font-semibold">Fjalët e tua</h3>
                <p class="text-sm text-muted mt-1">
                  Shkruaj natyrshëm dhe përmirësoje tekstin para miratimit.
                </p>
              </div>
            </div>
            <div class="flex gap-3">
              <UIcon name="i-lucide-calendar-check" class="size-5 text-primary shrink-0 mt-0.5" />
              <div>
                <h3 class="text-sm font-semibold">Një kalendar i qartë</h3>
                <p class="text-sm text-muted mt-1">
                  Mbaj në sy çfarë ke përgatitur dhe çfarë vjen më pas.
                </p>
              </div>
            </div>
          </div>
        </template>
        <div class="grid grid-cols-2 gap-3 sm:gap-4">
          <div class="pt-10">
            <img
              src="/images/coffee.jpg"
              alt="Kafe, një detaj për postimin e një kafeneje"
              width="360"
              height="440"
              loading="lazy"
              class="w-full aspect-[4/5] object-cover rounded-xl"
            />
            <p class="text-xs text-muted mt-3">Një produkt.</p>
          </div>
          <div>
            <img
              src="/images/interior.jpg"
              alt="Ambient kafeneje me bimë dhe dritë natyrale"
              width="360"
              height="440"
              loading="lazy"
              class="w-full aspect-[4/5] object-cover rounded-xl"
            />
            <p class="text-xs text-muted mt-3">Një vend. Një histori.</p>
          </div>
        </div>
      </UPageSection>
    </div>

    <UPageSection
      title="Nga ideja te postimi, në tre hapa."
      description="Pa menu të ndërlikuara. Pa pasur nevojë të jesh ekspert."
      :ui="{
        container: 'py-14 sm:py-20 lg:py-24 gap-10',
        title: 'text-3xl sm:text-4xl tracking-tight',
        description: 'text-base text-muted',
      }"
    >
      <UPageGrid class="gap-4 lg:gap-6"
        ><UPageCard
          v-for="step in steps"
          :key="step.number"
          variant="outline"
          :ui="{ container: 'p-6 sm:p-7 gap-4' }"
          ><div class="flex justify-between items-center">
            <span class="text-xs font-medium text-muted">{{ step.number }}</span
            ><UIcon :name="step.icon" class="size-5 text-primary" />
          </div>
          <h3 class="text-base font-semibold mt-3">{{ step.title }}</h3>
          <p class="text-sm text-muted leading-relaxed">{{ step.description }}</p></UPageCard
        ></UPageGrid
      >
    </UPageSection>

    <UContainer class="pb-14 sm:pb-20"
      ><UPageCTA
        title="Pak më shumë rregull. Më shumë kohë për biznesin."
        description="Krijo hapësirën e biznesit dhe shiko si i përshtatet mënyrës tënde të punës."
        variant="outline"
        orientation="horizontal"
        :ui="{
          container: 'p-7 sm:p-10 lg:p-12 gap-8',
          title: 'text-2xl sm:text-3xl tracking-tight',
          description: 'text-sm sm:text-base text-muted',
        }"
        ><div class="space-y-4">
          <p class="text-xs text-muted">Planet e propozuara, nga</p>
          <p v-if="plans.length" class="text-4xl font-semibold tracking-tight">
            {{ formatMoney(plans[0]!.price)
            }}<span class="text-sm text-muted font-normal tracking-normal"> / muaj</span>
          </p>
          <UButton
            to="/pricing"
            variant="outline"
            color="neutral"
            trailing-icon="i-lucide-arrow-right"
            >Shiko planet</UButton
          >
        </div></UPageCTA
      ></UContainer
    >

    <UPageSection
      title="Para se të fillosh."
      :ui="{
        container: 'pt-0 sm:pt-0 lg:pt-0 pb-14 sm:pb-20 lg:pb-20 gap-8 max-w-3xl',
        title: 'text-3xl sm:text-3xl tracking-tight',
      }"
      ><UAccordion
        :items="questions"
        :ui="{
          trigger: 'py-5 text-sm sm:text-base',
          body: 'text-sm text-muted leading-relaxed pb-5',
        }"
      />
      <p class="text-xs text-muted text-center mt-4">
        Ti kontrollon lidhjet e biznesit dhe miraton çdo postim.
      </p></UPageSection
    >
  </div>
</template>
