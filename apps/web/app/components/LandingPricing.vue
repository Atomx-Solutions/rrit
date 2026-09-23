<script setup lang="ts">
const { t } = useI18n()
withDefaults(defineProps<{ showDetailsLink?: boolean }>(), { showDetailsLink: true })
const { plans, error, status } = usePlanCatalog()
const { showError } = useFormFeedback()
watch(error, (value) => {
  if (value) showError(t('landing.pricingLoadErrorDescription'), 'warning')
}, { immediate: true })
const { capabilities } = useLandingOffer()
const billing = ref('monthly')
const annualDiscount = computed(() =>
  Math.max(0, ...plans.value.map((plan) => plan.annualDiscount)),
)
const billingOptions = computed(() => [
  { label: t('billing.monthly'), value: 'monthly' },
  { label: t('billing.annual'), value: 'annual', badge: `-${annualDiscount.value}%` },
])
const annual = computed(() => billing.value === 'annual' && annualDiscount.value > 0)
const pendingServices = computed(() => [
  ...(!capabilities.value?.billing ? [t('landing.pendingBilling')] : []),
  ...(!capabilities.value?.ai && plans.value.some((plan) => plan.entitlements.includes('ai'))
    ? [t('landing.pendingAi')]
    : []),
  ...(!capabilities.value?.publishing ? [t('landing.pendingPublishing')] : []),
])
</script>

<template>
  <div class="landing-pricing">
    <div
      v-if="error || status === 'pending'"
      class="landing-plan-grid"
      role="status"
      :aria-label="t('landing.loadingPlans')"
    >
      <USkeleton v-for="item in 3" :key="item" class="h-96 rounded-xl" />
    </div>
    <UAlert
      v-else-if="!plans.length"
      color="neutral"
      variant="outline"
      :title="t('landing.plansSoonTitle')"
      :description="t('landing.plansSoonDescription')"
    />
    <template v-else>
      <div v-if="annualDiscount > 0" class="landing-billing">
        <UTabs
          v-model="billing"
          :items="billingOptions"
          :content="false"
          :aria-label="t('landing.billingPeriod')"
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
          <UIcon name="i-lucide-info" aria-hidden="true" /> {{ t('legacy.costExplanation') }}
        </p>
        <p v-if="annual">
          {{ t('legacy.annualPriceExplanation') }}
        </p>
        <p v-if="pendingServices.length">
          {{ t('landing.pendingServices', { services: pendingServices.join(', ') }) }}
        </p>
      </div>
      <div class="landing-pricing-detail">
        <span>{{ t('legacy.pricingDescription') }}</span>
        <UButton
          v-if="showDetailsLink"
          to="/pricing"
          variant="link"
          color="neutral"
          trailing-icon="i-lucide-arrow-right"
          >{{ t('legacy.comparePlans') }}</UButton
        >
      </div>
    </template>
  </div>
</template>
