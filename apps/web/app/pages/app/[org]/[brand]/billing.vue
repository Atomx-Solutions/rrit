<script setup lang="ts">
import { formatMoney } from '~~/shared/utils/format'

definePageMeta({ layout: 'dashboard', middleware: 'workspace' })
const annual = ref(false)
const { data: trial } = await useFetch('/api/trial', { key: 'trial' })
const { t } = useI18n()
useSeoMeta({ title: () => `${t('nav.billing')} · Rrit` })
const {
  data: usage,
  error: usageError,
  refresh: refreshUsage,
} = await useFetch('/api/usage', {
  key: 'usage',
})
const { plans, error: catalogError, refresh } = usePlanCatalog()
const { page, pageSize, total, paginated } = usePagination(plans)
const selected = ref('')
const selectedPlan = computed(() => plans.value.find((plan) => plan.name === selected.value))
const planTextKeys: Record<string, { name: string; description: string; features: string[] }> = {
  Fillimi: { name: 'billing.planStart', description: 'billing.planStartDescription', features: ['billing.featureOneBusiness', 'billing.featureMeta', 'billing.feature12Drafts', 'billing.featurePhotos', 'billing.featureCalendar'] },
  Përditë: { name: 'billing.planWeekly', description: 'billing.planWeeklyDescription', features: ['billing.featureOneBusiness', 'billing.featureMeta', 'billing.feature30Drafts', 'billing.featureAiText', 'billing.featureApprovalPlanning'] },
  'Më shumë': { name: 'billing.planMore', description: 'billing.planMoreDescription', features: ['billing.featureOneBusiness', 'billing.featureMeta', 'billing.feature60Drafts', 'billing.featureAiText', 'billing.featurePriorityHelp'] },
}
function planName(name: string) { return planTextKeys[name] ? t(planTextKeys[name].name) : name }
function planDescription(name: string, fallback: string) { return planTextKeys[name] ? t(planTextKeys[name].description) : fallback }
function planFeature(name: string, index: number, fallback: string) {
  const key = planTextKeys[name]?.features[index]
  return key ? t(key) : fallback
}
const monthlyPrice = computed(
  () =>
    (selectedPlan.value?.price || 0) *
    (annual.value ? 1 - (selectedPlan.value?.annualDiscount || 0) / 100 : 1),
)
const usageLabels: Record<string, string> = {
  posts_per_month: 'billing.usagePosts',
  ai_requests_per_day: 'billing.usageAi',
  media_storage_bytes: 'billing.usageStorage',
  social_accounts: 'billing.usageSocial',
  members: 'billing.usageMembers',
}
const usageDescriptions: Record<string, string> = {
  posts_per_month: 'billing.usagePostsDescription',
  ai_requests_per_day: 'billing.usageAiDescription',
  members: 'billing.usageMembersDescription',
}
const exhaustedMessages: Record<string, string> = {
  posts_per_month: 'billing.limitPosts',
  ai_requests_per_day: 'billing.limitAi',
  members: 'billing.limitMembers',
  social_accounts: 'billing.limitSocial',
  media_storage_bytes: 'billing.limitStorage',
}

function translateOptional(key: string | undefined, fallback: string) {
  return key ? t(key) : fallback
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
    :title="t('nav.billing')"
    :description="t('billing.description')"
  >
    <template #toolbar>
      <div class="flex w-full flex-wrap items-center justify-between gap-3">
        <span class="text-sm text-muted">{{ t('billing.proposedPlans') }}</span>
        <div class="flex items-center gap-3">
          <span class="text-sm">{{ t('billing.monthly') }}</span
          ><USwitch v-model="annual" :aria-label="t('billing.annualBilling')" /><span class="text-sm"
            >{{ t('billing.annual') }}</span
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
              ? t('billing.serviceActive')
              : trial?.state === 'active'
                ? t('billing.trialActive')
                : t('billing.noActivePeriod')
          }}
        </h2>
        <p class="text-sm text-muted leading-relaxed">
          {{ t('billing.serviceDescription') }}
        </p>
      </div>
    </UCard>
    <UAlert
      v-if="usageError"
      color="warning"
      variant="outline"
      :title="t('billing.usageLoadError')"
      :actions="[{ label: t('common.retry'), variant: 'outline', onClick: () => refreshUsage() }]"
    />
    <template v-else-if="usage">
      <UCard :ui="{ body: 'p-4' }">
        <div class="flex items-center justify-between gap-4">
          <div class="flex min-w-0 items-center gap-3">
            <div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <UIcon name="i-lucide-coins" class="size-4 text-primary" />
            </div>
            <div class="min-w-0">
          <h2 class="text-sm font-semibold">{{ t('billing.aiCredits') }}</h2>
          <p class="text-xs text-muted">{{ t('billing.aiCreditsDescription') }}</p>
            </div>
          </div>
          <p class="shrink-0 text-sm font-semibold tabular-nums">
            {{ usage.credits.available }}
            <span class="text-xs font-normal text-muted">{{ t('billing.creditsUnit') }}</span>
          </p>
        </div>
        <UProgress
          class="mt-3"
          size="xs"
          :model-value="usage.credits.available"
          :max="usage.credits.limit"
          :color="
            usage.credits.state === 'exhausted'
              ? 'error'
              : usage.credits.state === 'low'
                ? 'warning'
                : 'primary'
          "
          :aria-label="t('billing.remainingCredits')"
        />
      </UCard>
      <UCard as="section" :ui="{ body: 'p-4' }">
        <div class="mb-5">
          <h2 class="text-sm font-semibold">{{ t('billing.currentUsage') }}</h2>
          <p class="text-sm text-muted mt-1">{{ t('billing.currentUsageDescription') }}</p>
        </div>
        <div class="grid gap-5 sm:grid-cols-2">
          <div v-for="item in usage.usage" :key="item.key" class="space-y-2">
            <div class="flex items-center justify-between gap-3 text-sm">
              <span>{{ translateOptional(usageLabels[item.key], item.key) }}</span>
              <span class="tabular-nums text-muted"
                >{{ usageValue(item.key, item.current) }} /
                {{ usageValue(item.key, item.limit) }}</span
              >
            </div>
            <p v-if="usageDescriptions[item.key]" class="text-xs leading-5 text-muted">
              {{ translateOptional(usageDescriptions[item.key], '') }}
            </p>
            <UProgress
              :model-value="item.percentage"
              :color="
                item.state === 'exhausted'
                  ? 'error'
                  : item.state === 'warning'
                    ? 'warning'
                    : 'primary'
              "
              :aria-label="`${translateOptional(usageLabels[item.key], item.key)}: ${item.percentage}%`"
            />
            <p v-if="item.state !== 'available'" class="text-xs text-muted">
              {{
                item.state === 'exhausted'
                  ? translateOptional(exhaustedMessages[item.key], t('billing.limitReached'))
                  : t('billing.limitWarning')
              }}
            </p>
          </div>
        </div>
      </UCard>
    </template>
    <UAlert
      v-if="catalogError"
      color="warning"
      variant="outline"
      :title="t('billing.catalogError')"
      :actions="[{ label: t('common.retry'), variant: 'outline', onClick: () => refresh() }]"
    />
    <UCard :ui="{ body: 'p-0 sm:p-0' }"
      ><div class="divide-y divide-default">
        <article
          v-for="plan in paginated"
          :key="plan.name"
          class="flex flex-wrap items-center gap-4 p-5"
        >
          <div class="min-w-0 flex-1 basis-48 space-y-1.5">
            <h2 class="text-base font-semibold">{{ planName(plan.name) }}</h2>
            <p class="text-sm text-muted">{{ planDescription(plan.name, plan.description) }}</p>
            <p class="text-xs text-muted">{{ planFeature(plan.name, 0, plan.features[0] ?? '') }} · {{ planFeature(plan.name, 2, plan.features[2] ?? '') }}</p>
          </div>
          <div class="text-left sm:text-right">
            <p class="text-xl font-semibold tabular-nums">
              {{ formatMoney(plan.price * (annual ? 1 - plan.annualDiscount / 100 : 1))
              }}<span class="text-xs font-normal text-muted"> / {{ t('billing.month') }}</span>
            </p>
            <p class="text-xs text-muted mt-1">
              {{
                annual
                  ? `${formatMoney(plan.price * (1 - plan.annualDiscount / 100) * 12)} ${t('billing.perYear')}`
                  : t('billing.monthlyBilling')
              }}
            </p>
          </div>
          <UButton
            variant="outline"
            color="neutral"
            :aria-label="`${t('trial.viewPlan')} ${planName(plan.name)}`"
            @click="selected = plan.name"
            >{{ t('trial.viewPlan') }}</UButton
          >
        </article>
      </div>
      <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total"
    /></UCard>
    <UCard as="section" :ui="{ body: 'p-0 sm:p-0', header: 'px-5 py-4' }">
      <template #header
        ><div class="flex items-center justify-between gap-3">
          <h2 class="text-sm font-semibold">{{ t('billing.yourInvoices') }}</h2>
          <span class="text-xs text-muted">{{ t('billing.currencyLabel') }}</span>
        </div></template
      >
      <DashboardEmpty
        :title="t('billing.noInvoices')"
        :description="t('billing.noInvoicesDescription')"
        icon="i-lucide-receipt-text"
        class="border-0 rounded-none"
      />
    </UCard>
    <UModal
      :open="!!selectedPlan"
      :title="`${t('billing.planTitle')} ${planName(selected)}`"
       :description="t('billing.planSummaryDescription')"
      @update:open="selected = $event ? selected : ''"
    >
      <template #body>
        <div v-if="selectedPlan" class="space-y-6">
          <div class="space-y-2">
            <p class="text-3xl font-semibold tracking-tight">
              {{ formatMoney(monthlyPrice)
              }}<span class="text-sm font-normal text-muted"> / {{ t('billing.month') }}</span>
            </p>
            <p class="text-sm text-muted">
              {{ annual ? `${formatMoney(monthlyPrice * 12)} ${t('billing.perYear')}` : t('billing.monthlyBilling') }} · {{ t('billing.illustrativePrice') }}
            </p>
          </div>
          <USeparator />
          <ul class="space-y-3">
            <li
              v-for="feature in selectedPlan.features"
              :key="feature"
              class="flex items-center gap-3 text-sm"
            >
              <UIcon name="i-lucide-check" class="size-4 text-primary shrink-0" />{{ planFeature(selectedPlan.name, selectedPlan.features.indexOf(feature), feature) }}
            </li>
          </ul>
          <UAlert
            color="neutral"
            variant="outline"
            icon="i-lucide-info"
             :title="t('billing.paymentsInactive')"
             :description="t('billing.paymentsInactiveDescription')"
          />
        </div>
      </template>
      <template #footer
        ><UButton color="neutral" variant="outline" class="ml-auto" @click="selected = ''"
           >{{ t('billing.closeSummary') }}</UButton
        ></template
      >
    </UModal>
  </DashboardPage>
</template>
