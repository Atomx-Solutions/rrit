<script setup lang="ts">
import { formatMoney } from '~~/shared/utils/format'

const props = defineProps<{ annual?: boolean; directSignup?: boolean }>()
const { plans } = usePlanCatalog()
const { trialLabel, canRegister } = useLandingOffer()
const emit = defineEmits<{ select: [name: string] }>()
const visiblePlans = computed(() =>
  props.directSignup ? [...plans.value].sort((a, b) => a.price - b.price) : plans.value,
)
const monthlyPrice = (price: number, discount: number) =>
  props.annual ? price * (1 - discount / 100) : price
const unitPrice = (plan: (typeof plans.value)[number]) =>
  plan.limits.posts_per_month > 0
    ? monthlyPrice(plan.price, plan.annualDiscount) / plan.limits.posts_per_month
    : Infinity
const recommended = computed(
  () =>
    [...plans.value]
      .filter((plan) => plan.limits.posts_per_month >= 30)
      .sort(
        (a, b) => monthlyPrice(a.price, a.annualDiscount) - monthlyPrice(b.price, b.annualDiscount),
      )[0]?.name,
)
const bestValue = computed(() =>
  plans.value.length > 1
    ? [...plans.value]
        .filter((plan) => plan.limits.posts_per_month > 0)
        .sort((a, b) => unitPrice(a) - unitPrice(b))[0]?.name
    : undefined,
)
const saving = (plan: (typeof plans.value)[number]) => {
  const entry = [...plans.value].sort((a, b) => a.price - b.price)[0]
  if (
    !entry ||
    entry.name === plan.name ||
    !Number.isFinite(unitPrice(entry)) ||
    unitPrice(entry) <= 0
  )
    return null
  const percent = Math.floor((1 - unitPrice(plan) / unitPrice(entry)) * 100)
  return percent > 0 ? `${percent}% më pak / postim se ${entry.name}` : null
}
</script>

<template>
  <UPricingPlans :class="directSignup ? 'landing-plan-grid' : 'gap-5'">
    <UPricingPlan
      v-for="(plan, i) in visiblePlans"
      :key="plan.name"
      :class="
        directSignup
          ? ['landing-plan-card', { 'landing-plan-featured': plan.name === recommended }]
          : undefined
      "
      :data-plan="plan.name"
      :title="plan.name"
      :description="plan.description"
      :price="formatMoney(monthlyPrice(plan.price, plan.annualDiscount))"
      billing-cycle="/ muaj"
      :billing-period="annual ? 'Faturim vjetor' : 'Faturim mujor'"
      :features="
        directSignup
          ? plan.features.filter(
              (feature) => feature !== `${plan.limits.posts_per_month} drafte postimesh në muaj`,
            )
          : plan.features
      "
      :highlight="plan.name === recommended"
      :badge="
        plan.name === recommended
          ? 'Rekomandimi ynë'
          : plan.name === bestValue
            ? 'Më lirë për postim'
            : undefined
      "
      :button="{
        label: `Shiko planin ${plan.name}`,
        variant: 'outline',
        color: i === 1 ? 'primary' : 'neutral',
        onClick: () => emit('select', plan.name),
      }"
      :terms="
        annual
          ? `${formatMoney(monthlyPrice(plan.price, plan.annualDiscount) * 12)} në vit`
          : directSignup
            ? 'Pa kartë bankare. Pa rinovim automatik.'
            : 'Pagesat ende nuk janë aktive'
      "
      :ui="{
        price: 'text-3xl tracking-tight',
        root: directSignup ? 'rounded-xl p-0 lg:p-0 xl:p-0 gap-0' : 'rounded-xl',
        description: 'text-sm leading-relaxed',
        featureTitle: 'text-sm',
        titleWrapper: 'flex-wrap',
      }"
    >
      <template v-if="directSignup" #title
        ><h3>{{ plan.name }}</h3></template
      >
      <template v-if="directSignup" #description>
        <p>{{ plan.description }}</p>
        <div class="landing-plan-quota">
          <UIcon name="i-lucide-images" aria-hidden="true" />
          <strong>{{ plan.limits.posts_per_month }} postime</strong><span>/ muaj</span>
        </div>
        <span v-if="saving(plan)" class="landing-plan-value">{{ saving(plan) }}</span>
        <span v-else class="landing-plan-value" aria-hidden="true">&nbsp;</span>
      </template>
      <template v-if="directSignup && plan.limits.posts_per_month > 0" #tagline>
        <div class="landing-plan-unit">
          <span>Kostoja për postim</span>
          <strong>{{
            formatMoney(monthlyPrice(plan.price, plan.annualDiscount) / plan.limits.posts_per_month)
          }}</strong>
        </div>
      </template>
      <template v-if="directSignup" #button>
        <UButton
          :to="canRegister ? '/signup' : '/help'"
          :variant="plan.name === recommended ? 'solid' : 'outline'"
          :color="plan.name === recommended ? 'primary' : 'neutral'"
          :class="plan.name === recommended ? 'landing-primary-button' : undefined"
          size="lg"
          block
          trailing-icon="i-lucide-arrow-up-right"
          >{{ canRegister ? trialLabel : 'Na kontakto' }}</UButton
        >
      </template>
    </UPricingPlan>
  </UPricingPlans>
</template>
