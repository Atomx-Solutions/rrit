<script setup lang="ts">
import { formatMoney } from '~~/shared/utils/format'
const { plans } = usePlanCatalog()
defineProps<{ annual?: boolean }>()
const emit = defineEmits<{ select: [name: string] }>()
</script>
<template>
  <UPricingPlans class="gap-5"
    ><UPricingPlan
      v-for="(plan, i) in plans"
      :key="plan.name"
      :title="plan.name"
      :description="plan.description"
      :price="formatMoney(plan.price * (annual ? 1 - plan.annualDiscount / 100 : 1))"
      billing-cycle="/ muaj"
      :billing-period="annual ? 'Faturim vjetor' : 'Faturim mujor'"
      :features="plan.features"
      :highlight="i === 1"
      :badge="i === 1 ? 'Për rritje' : undefined"
      :button="{
        label: `Shiko planin ${plan.name}`,
        variant: 'outline',
        color: i === 1 ? 'primary' : 'neutral',
        onClick: () => emit('select', plan.name),
      }"
      :terms="
        annual
          ? `${formatMoney(plan.price * (1 - plan.annualDiscount / 100) * 12)} në vit · Çmim ilustrues`
          : 'Pagesat ende nuk janë aktive'
      "
      :ui="{
        price: 'text-3xl tracking-tight',
        root: 'rounded-lg',
        description: 'text-sm leading-relaxed',
        featureTitle: 'text-sm',
      }"
  /></UPricingPlans>
</template>
