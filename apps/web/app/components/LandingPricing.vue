<script setup lang="ts">
withDefaults(defineProps<{ showDetailsLink?: boolean }>(), { showDetailsLink: true })
const { plans, error, status, refresh } = usePlanCatalog()
const { capabilities } = useLandingOffer()
const billing = ref('monthly')
const annualDiscount = computed(() =>
  Math.max(0, ...plans.value.map((plan) => plan.annualDiscount)),
)
const billingOptions = computed(() => [
  { label: 'Mujor', value: 'monthly' },
  { label: 'Vjetor', value: 'annual', badge: `deri −${annualDiscount.value}%` },
])
const annual = computed(() => billing.value === 'annual' && annualDiscount.value > 0)
const pendingServices = computed(() => [
  ...(!capabilities.value?.billing ? ['pagesat'] : []),
  ...(!capabilities.value?.ai && plans.value.some((plan) => plan.entitlements.includes('ai'))
    ? ['ndihma AI']
    : []),
  ...(!capabilities.value?.publishing ? ['publikimi automatik'] : []),
])
</script>

<template>
  <div class="landing-pricing">
    <UAlert
      v-if="error"
      color="warning"
      variant="outline"
      title="Çmimet nuk u ngarkuan."
      description="Provo sërish për të parë katalogun aktual."
      :actions="[{ label: 'Provo sërish', variant: 'outline', onClick: () => refresh() }]"
    />
    <div
      v-else-if="status === 'pending'"
      class="landing-plan-grid"
      role="status"
      aria-label="Duke ngarkuar planet"
    >
      <USkeleton v-for="item in 3" :key="item" class="h-96 rounded-xl" />
    </div>
    <UAlert
      v-else-if="!plans.length"
      color="neutral"
      variant="outline"
      title="Planet do të shfaqen së shpejti."
      description="Katalogu i çmimeve nuk është publikuar ende."
    />
    <template v-else>
      <div v-if="annualDiscount > 0" class="landing-billing">
        <UTabs
          v-model="billing"
          :items="billingOptions"
          :content="false"
          aria-label="Periudha e faturimit"
          :ui="{
            list: 'rounded-full p-1 bg-default ring ring-default',
            trigger: 'rounded-full px-5 min-h-10',
            indicator: 'rounded-full',
          }"
        />
      </div>
      <PlanCards :annual="annual" direct-signup />
      <div class="landing-pricing-footnotes">
        <p>
          <UIcon name="i-lucide-info" aria-hidden="true" /> Kostoja për postim llogaritet kur përdor
          të gjitha postimet e planit.
        </p>
        <p v-if="annual">
          Çmimi mujor është mesatarja e pagesës vjetore. Totali për vitin shfaqet te secili plan.
        </p>
        <p v-if="pendingServices.length">
          Në përgatitje: {{ pendingServices.join(', ') }}. Shërbimet e aktivizuara mund t’i shohësh
          në llogari.
        </p>
      </div>
      <div class="landing-pricing-detail">
        <span>Çmimet në euro. Të gjitha përfitimet, të shkruara qartë.</span>
        <UButton
          v-if="showDetailsLink"
          to="/pricing"
          variant="link"
          color="neutral"
          trailing-icon="i-lucide-arrow-right"
          >Krahaso planet në detaje</UButton
        >
      </div>
    </template>
  </div>
</template>
