<script setup lang="ts">
import { formatMoney } from '~~/shared/utils/format'

const { t } = useI18n()
const props = defineProps<{ annual?: boolean; directSignup?: boolean }>()
const { plans } = usePlanCatalog()
const { canRegister } = useLandingOffer()
const emit = defineEmits<{ select: [name: string] }>()

const planNameKeys: Record<string, string> = {
  'pako-1': 'billing.planPackage1',
  'pako-2': 'billing.planPackage2',
  'pako-3': 'billing.planPackage3',
}
type CatalogPlan = (typeof plans.value)[number]

function planName(plan: CatalogPlan) {
  const key = planNameKeys[plan.code]
  return key ? t(key) : plan.name
}
function planDescription(plan: CatalogPlan) {
  return t('billing.planDescription', {
    posts: plan.limits.posts_per_month,
    credits: plan.monthlyCredits,
  })
}
function planFeatures(plan: CatalogPlan) {
  return [
    t('billing.planPosts', { posts: plan.limits.posts_per_month }),
    t('billing.planTokens', { credits: plan.monthlyCredits }),
    t('billing.planStyleFetch', { count: plan.styleFetchPostCount }),
  ]
}

const commercialPlans = computed(() => plans.value.filter(plan => !plan.isTrial))
const visiblePlans = computed(() => [...commercialPlans.value].sort((a, b) => a.price - b.price))
const monthlyPrice = (price: number, discount: number) =>
  props.annual ? price * (1 - discount / 100) : price
const unitPrice = (plan: CatalogPlan) =>
  plan.limits.posts_per_month > 0
    ? monthlyPrice(plan.price, plan.annualDiscount) / plan.limits.posts_per_month
    : Infinity
const recommended = computed(
  () =>
    [...commercialPlans.value]
      .filter(plan => plan.limits.posts_per_month >= 30)
      .sort((a, b) => monthlyPrice(a.price, a.annualDiscount) - monthlyPrice(b.price, b.annualDiscount))[0]?.code,
)
const bestValue = computed(() =>
  commercialPlans.value.length > 1
    ? [...commercialPlans.value]
        .filter(plan => plan.limits.posts_per_month > 0)
        .sort((a, b) => unitPrice(a) - unitPrice(b))[0]?.code
    : undefined,
)
const saving = (plan: CatalogPlan) => {
  const entry = [...commercialPlans.value].sort((a, b) => a.price - b.price)[0]
  if (!entry || entry.code === plan.code || !Number.isFinite(unitPrice(entry)) || unitPrice(entry) <= 0)
    return null
  const percent = Math.floor((1 - unitPrice(plan) / unitPrice(entry)) * 100)
  return percent > 0 ? t('landing.lessPerPost', { percent, plan: planName(entry) }) : null
}
</script>

<template>
  <UPricingPlans :class="directSignup ? 'landing-plan-grid' : 'gap-5'">
    <UPricingPlan
      v-for="(plan, i) in visiblePlans"
      :key="plan.code"
      :class="directSignup ? ['landing-plan-card', { 'landing-plan-featured': plan.code === recommended }] : undefined"
      :data-plan="plan.code"
      :title="planName(plan)"
      :description="planDescription(plan)"
      :price="formatMoney(monthlyPrice(plan.price, plan.annualDiscount))"
      :billing-cycle="t('landing.perMonth')"
      :billing-period="annual ? t('billing.annualBilling') : t('billing.monthlyBilling')"
      :features="planFeatures(plan)"
      :highlight="plan.code === recommended"
      :badge="plan.code === recommended ? t('landing.recommended') : plan.code === bestValue ? t('landing.bestPerPost') : undefined"
      :button="{
        label: t('billing.buyPlanNow', { plan: planName(plan) }),
        variant: 'outline',
        color: i === 1 ? 'primary' : 'neutral',
        onClick: () => emit('select', plan.name),
      }"
      :terms="annual ? t('landing.perYear', { price: formatMoney(plan.annualPrice) }) : directSignup ? t('landing.noCardNoAutoRenewal') : t('billing.paymentsInactive')"
      :ui="{
        price: 'text-3xl tracking-tight',
        root: directSignup ? 'rounded-xl p-0 lg:p-0 xl:p-0 gap-0' : 'rounded-xl',
        description: 'text-sm leading-relaxed',
        featureTitle: 'text-sm',
        titleWrapper: 'flex-wrap',
      }"
    >
      <template v-if="directSignup" #title><h3>{{ planName(plan) }}</h3></template>
      <template v-if="directSignup" #description>
        <p>{{ planDescription(plan) }}</p>
        <div class="landing-plan-quota">
          <UIcon name="i-lucide-images" aria-hidden="true" />
          <strong>{{ plan.limits.posts_per_month }} {{ t('landing.posts') }}</strong><span>{{ t('landing.perMonth') }}</span>
        </div>
        <span v-if="saving(plan)" class="landing-plan-value">{{ saving(plan) }}</span>
        <span v-else class="landing-plan-value" aria-hidden="true">&nbsp;</span>
      </template>
      <template v-if="directSignup && plan.limits.posts_per_month > 0" #tagline>
        <div class="landing-plan-unit">
          <span>{{ t('legacy.costPerPost') }}</span>
          <strong>{{ formatMoney(monthlyPrice(plan.price, plan.annualDiscount) / plan.limits.posts_per_month) }}</strong>
        </div>
      </template>
      <template v-if="directSignup" #button>
        <UButton
          :to="canRegister ? '/signup' : '/help'"
          :variant="plan.code === recommended ? 'solid' : 'outline'"
          :color="plan.code === recommended ? 'primary' : 'neutral'"
          :class="plan.code === recommended ? 'landing-primary-button' : undefined"
          size="lg"
          block
          trailing-icon="i-lucide-arrow-up-right"
        >{{ canRegister ? t('billing.buyPlanNow', { plan: planName(plan) }) : t('landing.contactUs') }}</UButton>
      </template>
    </UPricingPlan>
  </UPricingPlans>
</template>
