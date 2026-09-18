<script setup lang="ts">
import { formatMoney } from '~~/shared/utils/format'

definePageMeta({ layout: 'dashboard', middleware: 'workspace' })
const annual = ref(false)
const { data: trial } = await useFetch('/api/trial', { key: 'trial' })
const { t } = useI18n()
const route = useRoute()
// Arriving here after the trial's 3 posts are used (PRC-07).
const trialLimitReached = computed(() => route.query.reason === 'trial-limit' && !trial.value?.paid)
useSeoMeta({ title: () => `${t('nav.billing')} · Rrit` })
const {
  data: usage,
  error: usageError,
  refresh: refreshUsage,
} = await useFetch('/api/usage', {
  key: 'usage',
})
const { plans, error: catalogError, refresh } = usePlanCatalog()
const { data: billing, refresh: refreshBilling } = await useFetch('/api/billing/subscription', {
  key: 'billing-subscription',
})
const { data: invoiceData, refresh: refreshInvoices } = await useFetch('/api/billing/invoices', {
  key: 'billing-invoices',
})
const detailsForm = reactive({ legalName: '', address: '', city: '', country: '', fiscalNumber: '' })
watch(() => invoiceData.value?.details, (details) => {
  if (details) Object.assign(detailsForm, details)
}, { immediate: true })
const savingDetails = ref(false)
const detailsMessage = ref<{ ok: boolean; text: string } | null>(null)
async function saveDetails() {
  savingDetails.value = true
  detailsMessage.value = null
  try {
    await $fetch('/api/billing/details', { method: 'PUT', body: { ...detailsForm } })
    await refreshInvoices()
    detailsMessage.value = { ok: true, text: t('billing.detailsSaved') }
  } catch {
    detailsMessage.value = { ok: false, text: t('billing.detailsFailed') }
  } finally {
    savingDetails.value = false
  }
}
function formatInvoiceDate(iso: string) {
  return new Intl.DateTimeFormat('sq-XK', { dateStyle: 'medium', timeZone: 'Europe/Belgrade' }).format(new Date(iso))
}
const commercialPlans = computed(() => plans.value.filter(plan => !plan.isTrial))
const annualDiscount = computed(() => Math.max(0, ...commercialPlans.value.map(plan => plan.annualDiscount)))
const { page, pageSize, total, paginated } = usePagination(commercialPlans)
const selected = ref('')
const selectedPlan = computed(() => commercialPlans.value.find((plan) => plan.name === selected.value))
const paidSubscription = computed(() =>
  billing.value?.subscription && billing.value.subscription.status !== 'trialing'
    ? billing.value.subscription
    : null,
)
function planByCode(code: string | null | undefined) {
  return commercialPlans.value.find((plan) => plan.code === code)
}
const switching = ref(false)
const switchError = ref('')
const topUpCredits = ref(500)
const topUpError = ref('')
const toppingUp = ref(false)
const topUpConfig = computed(() => billing.value?.creditTopUp)
const topUpValid = computed(() =>
  !!topUpConfig.value
  && Number.isInteger(topUpCredits.value)
  && topUpCredits.value >= topUpConfig.value.minimum
  && topUpCredits.value <= topUpConfig.value.maximum,
)
const topUpPrice = computed(() => topUpValid.value ? topUpCredits.value * topUpConfig.value!.unitPrice : 0)
async function switchPlan() {
  if (!selectedPlan.value) return
  switching.value = true
  switchError.value = ''
  try {
    await $fetch('/api/billing/subscription', {
      method: 'POST',
      body: { planCode: selectedPlan.value.code, interval: annual.value ? 'annual' : 'monthly' },
    })
    selected.value = ''
    await Promise.all([refreshBilling(), refreshUsage(), refreshNuxtData('trial'), refreshInvoices()])
  } catch {
    switchError.value = t('billing.activationFailed')
  } finally {
    switching.value = false
  }
}
async function buyCreditTopUp() {
  if (!topUpValid.value) return
  toppingUp.value = true
  topUpError.value = ''
  try {
    await $fetch('/api/billing/credit-top-up', {
      method: 'POST',
      body: { credits: topUpCredits.value, idempotencyKey: crypto.randomUUID() },
    })
    await Promise.all([refreshUsage(), refreshNuxtData('header-credit-balance'), refreshInvoices()])
  } catch {
    topUpError.value = t('billing.creditTopUpFailed')
  } finally {
    toppingUp.value = false
  }
}
function packageName(plan: (typeof plans.value)[number]) {
  const key = `billing.planPackage${plan.code.replace('pako-', '')}`
  return plan.code.startsWith('pako-') ? t(key) : plan.name
}
function packageDescription(plan: (typeof plans.value)[number]) {
  return t('billing.planDescription', {
    posts: plan.limits.posts_per_month,
    credits: plan.monthlyCredits,
  })
}
function packageFeatures(plan: (typeof plans.value)[number]) {
  return [
    t('billing.planPosts', { posts: plan.limits.posts_per_month }),
    t('billing.planTokens', { credits: plan.monthlyCredits }),
    t('billing.planStyleFetch', { count: plan.styleFetchPostCount }),
  ]
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
const postsUsage = computed(() => usage.value?.usage.find(item => item.key === 'posts_per_month'))

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
          ><USwitch v-model="annual" :aria-label="t('billing.annualBilling')" /><span class="flex items-center gap-1 text-sm"
            >{{ t('billing.annual') }}<UBadge v-if="annualDiscount > 0" size="sm" color="success" variant="subtle">-{{ annualDiscount }}%</UBadge></span
          >
        </div>
      </div>
    </template>
    <UAlert
      v-if="trialLimitReached"
      color="primary"
      variant="subtle"
      icon="i-lucide-sparkles"
      :title="t('billing.trialLimitTitle')"
      :description="t('billing.trialLimitDescription')"
    />
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
        <p v-if="planByCode(paidSubscription?.planCode)" class="text-sm font-medium">
          {{ t('billing.currentPlan', { plan: packageName(planByCode(paidSubscription?.planCode)!) }) }}
        </p>
        <p v-if="planByCode(paidSubscription?.pendingPlanCode)" class="text-xs text-muted">
          {{ t('billing.pendingDowngrade', { plan: packageName(planByCode(paidSubscription?.pendingPlanCode)!) }) }}
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
              <UIcon name="i-lucide-sparkles" class="size-4 text-primary" />
            </div>
            <div class="min-w-0">
              <h2 class="text-sm font-semibold">{{ t('billing.credits') }}</h2>
              <p class="text-xs text-muted">{{ t('billing.creditsDescription') }}</p>
            </div>
          </div>
          <p class="shrink-0 text-sm font-semibold tabular-nums" data-testid="credit-balance">
            {{ usage.credits.spendable }}
            <span class="text-xs font-normal text-muted">{{ t('billing.creditsUnit') }}</span>
          </p>
        </div>
      </UCard>
      <UAlert
        v-if="usage.credits.spendable === 0"
        color="warning"
        variant="outline"
        icon="i-lucide-circle-alert"
        :title="t('billing.creditsExhausted')"
      />
      <UCard v-if="billing?.selfServiceEnabled && topUpConfig" id="credit-top-up-section" as="section" class="scroll-mt-4" :ui="{ body: 'p-4 sm:p-5' }">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div class="space-y-1">
            <h2 class="text-sm font-semibold">{{ t('billing.creditTopUpTitle') }}</h2>
            <p class="text-sm text-muted">{{ t('billing.creditTopUpDescription') }}</p>
            <p class="text-xs text-muted">{{ t('billing.creditTopUpExpiry') }}</p>
          </div>
          <div class="flex flex-col gap-2 sm:w-80">
            <UFormField name="credit-top-up" :label="t('billing.creditTopUpQuantity')">
              <UInputNumber
                id="credit-top-up"
                v-model="topUpCredits"
                :min="topUpConfig.minimum"
                :max="topUpConfig.maximum"
                :step="1"
              />
            </UFormField>
            <p class="text-xs text-muted">
              {{ t('billing.creditTopUpRange', { minimum: topUpConfig.minimum, maximum: topUpConfig.maximum }) }}
            </p>
            <p class="text-sm font-semibold tabular-nums">
              {{ t('billing.creditTopUpPrice', { price: formatMoney(topUpPrice) }) }}
            </p>
            <UAlert v-if="topUpError" color="error" variant="outline" :title="topUpError" />
            <UButton :disabled="!topUpValid" :loading="toppingUp" @click="buyCreditTopUp">
              {{ t('billing.buyCreditTopUp') }}
            </UButton>
          </div>
        </div>
      </UCard>
      <UCard as="section" :ui="{ body: 'p-4' }">
        <div class="mb-5">
          <h2 class="text-sm font-semibold">{{ t('billing.currentUsage') }}</h2>
          <p class="text-sm text-muted mt-1">{{ t('billing.currentUsageDescription') }}</p>
          <p v-if="postsUsage" class="text-sm font-medium mt-2">
            {{ t('billing.postsRemaining', { count: usageValue('posts_per_month', postsUsage.remaining) }) }}
          </p>
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
    <UCard id="plans" class="scroll-mt-4" :ui="{ body: 'p-0 sm:p-0' }"
      ><div class="divide-y divide-default">
        <article
          v-for="plan in paginated"
          :key="plan.code"
          class="flex flex-wrap items-center gap-4 p-5"
        >
          <div class="min-w-0 flex-1 basis-48 space-y-1.5">
            <h2 class="flex items-center gap-2 text-base font-semibold">
              {{ packageName(plan)
              }}<UBadge v-if="paidSubscription?.planCode === plan.code" size="sm" variant="subtle">{{
                t('billing.currentPlanBadge')
              }}</UBadge>
            </h2>
            <p class="text-sm text-muted">{{ packageDescription(plan) }}</p>
            <p class="text-xs text-muted">{{ packageFeatures(plan)[0] }} · {{ packageFeatures(plan)[2] }}</p>
          </div>
          <div class="text-left sm:text-right">
            <p class="text-xl font-semibold tabular-nums">
              {{ formatMoney(plan.price * (annual ? 1 - plan.annualDiscount / 100 : 1))
              }}<span class="text-xs font-normal text-muted"> / {{ t('billing.month') }}</span>
            </p>
            <p class="text-xs text-muted mt-1">
              {{
                annual
                  ? `${formatMoney(plan.annualPrice)} ${t('billing.perYear')}`
                  : t('billing.monthlyBilling')
              }}
            </p>
          </div>
          <UButton
            variant="outline"
            color="neutral"
            :aria-label="t('billing.buyPlanNow', { plan: packageName(plan) })"
            @click="selected = plan.name"
            >{{ t('billing.buyPlanNow', { plan: packageName(plan) }) }}</UButton
          >
        </article>
      </div>
      <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total"
    /></UCard>
    <UCard id="invoices" as="section" :ui="{ body: 'p-0 sm:p-0', header: 'px-5 py-4' }">
      <template #header
        ><div class="flex items-center justify-between gap-3">
          <h2 class="text-sm font-semibold">{{ t('billing.yourInvoices') }}</h2>
          <span class="text-xs text-muted">{{ t('billing.currencyLabel') }}</span>
        </div></template
      >
      <ul v-if="invoiceData?.invoices.length" class="divide-y divide-default" data-testid="invoice-list">
        <li
          v-for="invoice in invoiceData.invoices"
          :key="invoice.id"
          class="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
        >
          <div class="min-w-0">
            <p class="text-sm font-medium tabular-nums">
              {{ invoice.number }}
              <UBadge v-if="invoice.kind === 'credit_note'" size="sm" color="neutral" variant="subtle">{{ t('billing.creditNote') }}</UBadge>
            </p>
            <p class="text-xs text-muted truncate">
              {{ formatInvoiceDate(invoice.issuedAt) }} · {{ invoice.lines.map(line => line.description).join(', ') }}
            </p>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-sm font-semibold tabular-nums">{{ formatMoney(invoice.total) }}</span>
            <UButton
              :to="`/api/billing/invoices/${invoice.id}/pdf`"
              external
              download
              icon="i-lucide-download"
              color="neutral"
              variant="outline"
              size="sm"
              :aria-label="t('billing.downloadInvoice', { number: invoice.number })"
            >PDF</UButton>
          </div>
        </li>
      </ul>
      <DashboardEmpty
        v-else
        :title="t('billing.noInvoices')"
        :description="t('billing.noInvoicesDescription')"
        icon="i-lucide-receipt-text"
        class="border-0 rounded-none"
      />
    </UCard>
    <UCard id="billing-details" as="section" :ui="{ body: 'p-4 sm:p-5', header: 'px-5 py-4' }">
      <template #header>
        <h2 class="text-sm font-semibold">{{ t('billing.detailsTitle') }}</h2>
        <p class="text-xs text-muted mt-1">{{ t('billing.detailsDescription') }}</p>
      </template>
      <UForm :state="detailsForm" class="grid gap-3 sm:grid-cols-2" @submit="saveDetails">
        <UFormField name="legalName" :label="t('billing.detailsLegalName')" required>
          <UInput v-model="detailsForm.legalName" class="w-full" maxlength="160" />
        </UFormField>
        <UFormField name="fiscalNumber" :label="t('billing.detailsFiscalNumber')" :hint="t('billing.detailsOptional')">
          <UInput v-model="detailsForm.fiscalNumber" class="w-full" maxlength="40" />
        </UFormField>
        <UFormField name="address" :label="t('billing.detailsAddress')" class="sm:col-span-2">
          <UInput v-model="detailsForm.address" class="w-full" maxlength="240" />
        </UFormField>
        <UFormField name="city" :label="t('billing.detailsCity')">
          <UInput v-model="detailsForm.city" class="w-full" maxlength="120" />
        </UFormField>
        <UFormField name="country" :label="t('billing.detailsCountry')">
          <UInput v-model="detailsForm.country" class="w-full" maxlength="120" />
        </UFormField>
        <div class="flex items-center gap-3 sm:col-span-2">
          <UButton type="submit" :loading="savingDetails" icon="i-lucide-save">{{ t('billing.detailsSave') }}</UButton>
          <span v-if="detailsMessage" role="status" class="text-xs" :class="detailsMessage.ok ? 'text-muted' : 'text-error'">{{ detailsMessage.text }}</span>
        </div>
      </UForm>
    </UCard>
    <UModal
      :open="!!selectedPlan"
      :title="selectedPlan ? `${t('billing.planTitle')} ${packageName(selectedPlan)}` : t('billing.planTitle')"
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
              {{ annual ? `${formatMoney(selectedPlan.annualPrice)} ${t('billing.perYear')}` : t('billing.monthlyBilling') }}<template v-if="!billing?.selfServiceEnabled"> · {{ t('billing.illustrativePrice') }}</template>
            </p>
            <p class="text-xs text-muted">{{ t('billing.creditsRefreshMonthly') }}</p>
          </div>
          <USeparator />
          <ul class="space-y-3">
            <li
              v-for="feature in packageFeatures(selectedPlan)"
              :key="feature"
              class="flex items-center gap-3 text-sm"
            >
              <UIcon name="i-lucide-check" class="size-4 text-primary shrink-0" />{{ feature }}
            </li>
          </ul>
          <UAlert
            v-if="!billing?.selfServiceEnabled"
            color="neutral"
            variant="outline"
            icon="i-lucide-info"
             :title="t('billing.paymentsInactive')"
             :description="t('billing.paymentsInactiveDescription')"
          />
          <UAlert v-if="switchError" color="error" variant="outline" :title="switchError" />
        </div>
      </template>
      <template #footer
        ><div class="ml-auto flex gap-2">
          <UButton color="neutral" variant="outline" @click="selected = ''"
            >{{ t('billing.closeSummary') }}</UButton
          >
          <UButton
            v-if="billing?.selfServiceEnabled && selectedPlan?.code !== paidSubscription?.planCode"
            :loading="switching"
            @click="switchPlan"
            >{{ paidSubscription ? t('billing.changePlan') : t('billing.activatePlan') }}</UButton
          >
        </div></template
      >
    </UModal>
  </DashboardPage>
</template>
