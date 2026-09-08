<script setup lang="ts">
definePageMeta({ layout: 'public' })
useSeoMeta({ title: 'Planet dhe çmimet · Rrit' })
const annual = ref(false)
const selected = ref('')
const { data: capabilities } = await useFetch('/api/capabilities')
const { error, refresh } = usePlanCatalog()
</script>
<template>
  <section class="public-section">
    <div class="text-center max-w-2xl mx-auto mb-10 space-y-5">
      <p class="eyebrow">SIPAS BIZNESIT TËND</p>
      <h1>Fillo me kohë për ta provuar.</h1>
      <p v-if="capabilities?.trialHours" class="text-muted">
        Çdo biznes i ri që plotëson kushtet merr {{ capabilities.trialHours / 24 }} ditë trial falas
        për të gjitha shërbimet e aktivizuara. Pa kartë dhe pa rinovim automatik.
      </p>
      <div class="flex items-center justify-center gap-3">
        <span>Mujor</span><USwitch v-model="annual" aria-label="Shfaq faturimin vjetor" /><span
          >Vjetor</span
        >
      </div>
    </div>
    <UAlert
      v-if="error"
      variant="outline"
      color="warning"
      title="Planet nuk u ngarkuan"
      :actions="[{ label: 'Provo sërish', variant: 'outline', onClick: () => refresh() }]"
    />
    <PlanCards :annual="annual" @select="selected = $event" />
    <div class="max-w-2xl mx-auto mt-10 space-y-5">
      <UAlert
        color="neutral"
        variant="outline"
        title="Çmimet janë në euro"
        description="Pagesat me kartë ende nuk janë aktivizuar. Nuk krijohet detyrim pagese nga zgjedhja e një plani."
      /><UAccordion
        :items="[
          {
            label: 'Kur fillon trial-i?',
            content: `${capabilities?.emailVerificationRequired ? 'Pas verifikimit të emailit dhe' : 'Pas'} krijimit të profilit të biznesit. Kohëzgjatja dhe gjendja shfaqen në hapësirën tënde.`,
          },
          {
            label: 'A marr trial tjetër me të njëjtën faqe?',
            content:
              'Jo. Kontrollohen emaili i verifikuar, identitetet e lidhura nga Meta dhe identifikuesi i ruajtur i pajisjes. Lidhja e një identiteti të përdorur më parë mund ta ndalë trial-in.',
          },
          {
            label: 'Çfarë ndodh kur trial-i përfundon?',
            content:
              'Të dhënat mbeten të lexueshme dhe të eksportueshme. Krijimi, importimi dhe publikimi kërkojnë një periudhë aktive shërbimi.',
          },
        ]"
      />
    </div>
    <UModal
      :open="!!selected"
      :title="'Plani ' + selected"
      description="Pagesat ende nuk janë aktivizuar."
      @update:open="selected = $event ? selected : ''"
      ><template #body
        ><div class="space-y-5">
          <p class="text-sm text-muted">
            Krijo llogarinë tënde për trial-in falas. Nuk kërkohet kartë bankare.
          </p>
          <UButton to="/signup" variant="outline" block>Fillo me biznesin tënd</UButton>
        </div></template
      ></UModal
    >
  </section>
</template>
