<script setup lang="ts">
import { formatMoney } from '~~/shared/utils/format'

definePageMeta({ layout: 'dashboard', middleware: 'workspace' })
useSeoMeta({ title: 'Plani dhe faturimi · Rrit' })
const annual = ref(false)
const { data: trial } = await useFetch('/api/trial', { key: 'trial' })
const { data: usage, error: usageError, refresh: refreshUsage } = await useFetch('/api/usage', {
  key: 'usage',
})
const { plans, error: catalogError, refresh } = usePlanCatalog()
const { page, pageSize, total, paginated } = usePagination(plans)
const selected = ref('')
const selectedPlan = computed(() => plans.value.find((plan) => plan.name === selected.value))
const monthlyPrice = computed(
  () =>
    (selectedPlan.value?.price || 0) *
    (annual.value ? 1 - (selectedPlan.value?.annualDiscount || 0) / 100 : 1),
)
const usageLabels: Record<string, string> = {
  posts_per_month: 'Postime këtë muaj',
  ai_requests_per_day: 'Përgatitje me AI sot',
  media_storage_bytes: 'Hapësira e fotografive',
  social_accounts: 'Llogari sociale',
  members: 'Anëtarë',
}
function usageValue(key: string, value: number) {
  if (key === 'media_storage_bytes') {
    const megabytes = value / 1024 / 1024
    return `${megabytes >= 100 ? Math.round(megabytes) : megabytes.toFixed(1)} MB`
  }
  return new Intl.NumberFormat('sq-AL').format(value)
}
</script>
<template>
  <DashboardPage
    title="Plani dhe faturimi"
    description="Zgjidh hapësirën që i përshtatet biznesit tënd. Të gjitha çmimet janë në euro."
  >
    <template #toolbar>
      <div class="flex w-full flex-wrap items-center justify-between gap-3">
        <span class="text-sm text-muted">Paketat e propozuara</span>
        <div class="flex items-center gap-3">
          <span class="text-sm">Mujor</span
          ><USwitch v-model="annual" aria-label="Faturim vjetor" /><span class="text-sm"
            >Vjetor</span
          >
        </div>
      </div>
    </template>
    <UCard :ui="{ body: 'p-4 sm:p-5 flex items-start gap-4' }">
      <UIcon name="i-lucide-credit-card" class="size-5 text-muted shrink-0 mt-0.5" />
      <div class="space-y-1">
        <h2 class="text-sm font-semibold">
          {{
            trial?.paid
              ? 'Shërbim aktiv'
              : trial?.state === 'active'
                ? 'Trial falas aktiv'
                : 'Pa periudhë aktive'
          }}
        </h2>
        <p class="text-sm text-muted leading-relaxed">
          Gjendja e shërbimit kontrollohet nga serveri. Pagesat me kartë ende nuk janë aktivizuar;
          nuk kryhet rinovim ose tarifim automatik.
        </p>
      </div>
    </UCard>
    <UAlert
      v-if="usageError"
      color="warning"
      variant="outline"
      title="Përdorimi nuk u ngarkua"
      :actions="[{ label: 'Provo sërish', variant: 'outline', onClick: () => refreshUsage() }]"
    />
    <UCard v-else-if="usage" as="section" :ui="{ body: 'p-5 sm:p-6' }">
      <div class="mb-5">
        <h2 class="text-sm font-semibold">Përdorimi aktual</h2>
        <p class="text-sm text-muted mt-1">Kufijtë vijnë nga shërbimi aktiv në server.</p>
      </div>
      <div class="grid gap-5 sm:grid-cols-2">
        <div v-for="item in usage.usage" :key="item.key" class="space-y-2">
          <div class="flex items-center justify-between gap-3 text-sm">
            <span>{{ usageLabels[item.key] || item.key }}</span>
            <span class="tabular-nums text-muted"
              >{{ usageValue(item.key, item.current) }} / {{ usageValue(item.key, item.limit) }}</span
            >
          </div>
          <UProgress
            :model-value="item.percentage"
            :color="item.state === 'exhausted' ? 'error' : item.state === 'warning' ? 'warning' : 'primary'"
            :aria-label="`${usageLabels[item.key] || item.key}: ${item.percentage}%`"
          />
          <p v-if="item.state !== 'available'" class="text-xs text-muted">
            {{
              item.state === 'exhausted'
                ? 'Kufiri është arritur.'
                : 'Po i afrohesh kufirit të planit.'
            }}
          </p>
        </div>
      </div>
    </UCard>
    <UAlert
      v-if="catalogError"
      color="warning"
      variant="outline"
      title="Paketat nuk mund të ngarkohen"
      :actions="[{ label: 'Provo sërish', variant: 'outline', onClick: () => refresh() }]"
    />
    <UCard :ui="{ body: 'p-0 sm:p-0' }"
      ><div class="divide-y divide-default">
        <article
          v-for="plan in paginated"
          :key="plan.name"
          class="flex flex-wrap items-center gap-4 p-5"
        >
          <div class="min-w-0 flex-1 basis-48 space-y-1.5">
            <h2 class="text-base font-semibold">{{ plan.name }}</h2>
            <p class="text-sm text-muted">{{ plan.description }}</p>
            <p class="text-xs text-muted">{{ plan.features[0] }} · {{ plan.features[2] }}</p>
          </div>
          <div class="text-left sm:text-right">
            <p class="text-xl font-semibold tabular-nums">
              {{ formatMoney(plan.price * (annual ? 1 - plan.annualDiscount / 100 : 1))
              }}<span class="text-xs font-normal text-muted"> / muaj</span>
            </p>
            <p class="text-xs text-muted mt-1">
              {{
                annual
                  ? `${formatMoney(plan.price * (1 - plan.annualDiscount / 100) * 12)} në vit`
                  : 'Faturim mujor'
              }}
            </p>
          </div>
          <UButton
            variant="outline"
            color="neutral"
            :aria-label="`Shiko planin ${plan.name}`"
            @click="selected = plan.name"
            >Shiko planin</UButton
          >
        </article>
      </div>
      <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total"
    /></UCard>
    <UCard as="section" :ui="{ body: 'p-0 sm:p-0', header: 'px-5 py-4' }">
      <template #header
        ><div class="flex items-center justify-between gap-3">
          <h2 class="text-sm font-semibold">Faturat e tua</h2>
          <span class="text-xs text-muted">EUR · €</span>
        </div></template
      >
      <DashboardEmpty
        title="Nuk ka fatura"
        description="Faturat do të shfaqen këtu pas pagesës së parë të konfirmuar."
        icon="i-lucide-receipt-text"
        class="border-0 rounded-none"
      />
    </UCard>
    <UModal
      :open="!!selectedPlan"
      :title="`Plani ${selected}`"
      description="Shiko përmbledhjen e paketës."
      @update:open="selected = $event ? selected : ''"
    >
      <template #body>
        <div v-if="selectedPlan" class="space-y-6">
          <div class="space-y-2">
            <p class="text-3xl font-semibold tracking-tight">
              {{ formatMoney(monthlyPrice)
              }}<span class="text-sm font-normal text-muted"> / muaj</span>
            </p>
            <p class="text-sm text-muted">
              {{ annual ? `${formatMoney(monthlyPrice * 12)} në vit` : 'Faturim mujor' }} · Çmim
              ilustrues
            </p>
          </div>
          <USeparator />
          <ul class="space-y-3">
            <li
              v-for="feature in selectedPlan.features"
              :key="feature"
              class="flex items-center gap-3 text-sm"
            >
              <UIcon name="i-lucide-check" class="size-4 text-primary shrink-0" />{{ feature }}
            </li>
          </ul>
          <UAlert
            color="neutral"
            variant="outline"
            icon="i-lucide-info"
            title="Pagesat ende nuk janë aktive"
            description="Asnjë pagesë nuk do të kryhet. Kushtet, taksat dhe kufijtë përfundimtarë do të konfirmohen para aktivizimit të abonimeve."
          />
        </div>
      </template>
      <template #footer
        ><UButton color="neutral" variant="outline" class="ml-auto" @click="selected = ''"
          >Mbyll përmbledhjen</UButton
        ></template
      >
    </UModal>
  </DashboardPage>
</template>
