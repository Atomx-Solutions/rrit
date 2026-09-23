<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { formatMoney } from '~~/shared/utils/format'

definePageMeta({ layout: 'admin', middleware: 'superadmin' })

type CreditPricing = { credit_price_cents: number, provider_cost_per_credit_micro_eur: number, low_credit_threshold: number }
type InvoiceSettings = { number_prefix: string, seller_name: string, seller_address: string, seller_fiscal_number: string, vat_rate_basis_points: number }
type AdminPlan = {
  code: string
  name: string
  monthly_cents: number
  posts_per_month: number
  monthly_credits: number
  annual_discount_percent: number
  active_subscriptions: number
  is_trial: boolean
  active: boolean
}
type PlanDraft = {
  name: string
  monthly_price: number
  posts_per_month: number
  monthly_credits: number
  annual_discount_percent: number
  active: boolean
}

const { t } = useI18n()
const toast = useToast()
useSeoMeta({ title: () => t('admin.nav.plans'), robots: 'noindex, nofollow' })
const { data, error, refresh } = await useFetch<{
  plans: AdminPlan[]
  credit_pricing: CreditPricing
  invoice_settings: InvoiceSettings
}>('/api/admin/plans', { lazy: true, key: 'admin-plans' })

const plans = computed(() => data.value?.plans || [])
const drafts = reactive<Record<string, PlanDraft>>({})
watch(plans, (value) => {
  for (const plan of value) {
    drafts[plan.code] = {
      name: plan.name,
      monthly_price: plan.monthly_cents / 100,
      posts_per_month: plan.posts_per_month,
      monthly_credits: plan.monthly_credits,
      annual_discount_percent: plan.annual_discount_percent,
      active: plan.active,
    }
  }
}, { immediate: true })

function draft(plan: AdminPlan) {
  return drafts[plan.code]!
}
function changed<T extends Record<string, unknown>>(current: T | undefined, next: Partial<T>) {
  return Object.fromEntries(Object.entries(next).filter(([key, value]) => current?.[key] !== value))
}
function planChanges(plan: AdminPlan) {
  const value = draft(plan)
  return changed(plan, {
    name: value.name.trim(),
    monthly_cents: Math.round(Number(value.monthly_price) * 100),
    posts_per_month: Number(value.posts_per_month),
    monthly_credits: Number(value.monthly_credits),
    annual_discount_percent: plan.is_trial ? 0 : Number(value.annual_discount_percent),
    active: value.active,
  })
}
function planInvalid(plan: AdminPlan) {
  const value = draft(plan)
  return !value.name.trim()
    || value.monthly_price < (plan.is_trial ? 0 : 0.01)
    || value.posts_per_month < 0
    || value.monthly_credits < 0
    || value.annual_discount_percent < 0
    || value.annual_discount_percent > 100
}
function annualPrice(plan: AdminPlan) {
  const value = draft(plan)
  const discount = plan.is_trial ? 0 : value.annual_discount_percent
  return Math.round(value.monthly_price * 12 * (1 - discount / 100) * 100) / 100
}
function adjustMonthlyPrice(plan: AdminPlan, amount: number) {
  const minimum = plan.is_trial ? 0 : 0.01
  draft(plan).monthly_price = Math.max(minimum, Math.round((draft(plan).monthly_price + amount) * 100) / 100)
}

const savingPlans = reactive<Record<string, boolean>>({})
async function savePlan(plan: AdminPlan) {
  const body = planChanges(plan)
  if (!Object.keys(body).length || planInvalid(plan)) return
  savingPlans[plan.code] = true
  try {
    await $fetch('/api/admin/plans/' + plan.code, { method: 'PATCH', body })
    toast.add({ title: t('admin.plans.saved'), color: 'success' })
    await refresh()
  } catch (problem) {
    toast.add({ title: (problem as { data?: { message?: string } }).data?.message || t('admin.plans.saveFailed'), color: 'error' })
  } finally {
    savingPlans[plan.code] = false
  }
}

const pricing = reactive({ credit_price: 0, provider_cost: 0, low_credit_threshold: 0 })
const invoice = reactive({ number_prefix: '', seller_name: '', seller_address: '', seller_fiscal_number: '', vat_percent: 0 })
watch(data, (value) => {
  if (!value) return
  Object.assign(pricing, {
    credit_price: value.credit_pricing.credit_price_cents / 100,
    provider_cost: value.credit_pricing.provider_cost_per_credit_micro_eur / 1_000_000,
    low_credit_threshold: value.credit_pricing.low_credit_threshold,
  })
  Object.assign(invoice, {
    number_prefix: value.invoice_settings.number_prefix,
    seller_name: value.invoice_settings.seller_name,
    seller_address: value.invoice_settings.seller_address,
    seller_fiscal_number: value.invoice_settings.seller_fiscal_number,
    vat_percent: value.invoice_settings.vat_rate_basis_points / 100,
  })
}, { immediate: true })
const pricingChanges = computed(() => changed(data.value?.credit_pricing, {
  credit_price_cents: Math.round(Number(pricing.credit_price) * 100),
  provider_cost_per_credit_micro_eur: Math.round(Number(pricing.provider_cost) * 1_000_000),
  low_credit_threshold: Number(pricing.low_credit_threshold),
}))
const invoiceChanges = computed(() => changed(data.value?.invoice_settings, {
  number_prefix: invoice.number_prefix.trim().toUpperCase(),
  seller_name: invoice.seller_name.trim(),
  seller_address: invoice.seller_address.trim(),
  seller_fiscal_number: invoice.seller_fiscal_number.trim(),
  vat_rate_basis_points: Math.round(Number(invoice.vat_percent) * 100),
}))
const margin = computed(() => pricing.credit_price > 0 ? Math.round((1 - pricing.provider_cost / pricing.credit_price) * 100) : 0)
const pricingInvalid = computed(() => pricing.credit_price <= 0 || pricing.provider_cost <= 0 || pricing.low_credit_threshold < 0)
const invoiceInvalid = computed(() => invoice.vat_percent < 0 || invoice.vat_percent > 100 || !invoice.seller_name.trim())
const saving = reactive({ pricing: false, invoice: false })

async function saveSettings(kind: 'pricing' | 'invoice') {
  const body = kind === 'pricing' ? pricingChanges.value : invoiceChanges.value
  if (!Object.keys(body).length || (kind === 'pricing' ? pricingInvalid.value : invoiceInvalid.value)) return
  saving[kind] = true
  try {
    await $fetch(kind === 'pricing' ? '/api/admin/plans/credit-pricing' : '/api/admin/plans/invoice-settings', { method: 'PATCH', body })
    toast.add({ title: t('admin.plans.saved'), color: 'success' })
    await refresh()
  } catch (problem) {
    toast.add({ title: (problem as { data?: { message?: string } }).data?.message || t('admin.plans.saveFailed'), color: 'error' })
  } finally {
    saving[kind] = false
  }
}

const wide = { class: { th: 'hidden xl:table-cell', td: 'hidden xl:table-cell' } }
const columns = computed<TableColumn<AdminPlan>[]>(() => [
  { accessorKey: 'name', header: t('admin.plans.plan') },
  { id: 'price', header: t('admin.plans.monthlyPrice') },
  { id: 'annual', header: t('admin.plans.annualDiscount'), meta: wide },
  { id: 'posts', header: t('admin.plans.posts') },
  { id: 'credits', header: t('admin.plans.credits') },
  { id: 'subscriptions', header: t('admin.plans.activeSubscriptions'), meta: wide },
  { id: 'status', header: t('admin.plans.active') },
  { id: 'actions', header: '' },
])
const cardUi = { header: 'px-4 py-3 sm:px-5', body: 'p-4 sm:p-5' }
</script>

<template>
  <AdminPage :title="t('admin.nav.plans')">
    <UAlert v-if="error" color="error" variant="subtle" :title="t('admin.plans.loadError')" :actions="[{ label: t('common.retry'), variant: 'outline', onClick: () => refresh() }]" />
    <template v-else>
      <UCard class="shrink-0" :ui="{ header: 'px-4 py-3 sm:px-5', body: 'p-0 sm:p-0' }">
        <template #header>
          <UUser :name="t('admin.plans.packagesTitle')" :description="t('admin.plans.packagesDescription')" :avatar="{ icon: 'i-lucide-package', size: 'sm' }" />
        </template>
        <UCard v-for="plan in plans" :key="plan.code" class="md:hidden" :ui="{ root: 'rounded-none ring-0 border-b border-default', body: 'p-4 sm:p-4 space-y-4' }">
          <div class="flex items-center justify-between gap-3">
            <p class="font-medium">{{ plan.code }}</p>
            <UBadge v-if="Object.keys(planChanges(plan)).length" color="warning" variant="subtle" :label="t('admin.plans.unsaved')" />
          </div>
          <UForm :state="draft(plan)" class="grid gap-3 sm:grid-cols-2" @submit="savePlan(plan)">
            <UFormField name="name" :label="t('admin.plans.name')" class="sm:col-span-2"><UInput v-model="draft(plan).name" maxlength="120" class="w-full" /></UFormField>
            <UFormField name="monthly_price" :label="t('admin.plans.monthlyPrice')"><UFieldGroup class="w-full"><UButton type="button" icon="i-lucide-minus" color="neutral" variant="outline" :disabled="plan.is_trial" @click="adjustMonthlyPrice(plan, -0.10)" /><UInput v-model.number="draft(plan).monthly_price" type="number" :min="plan.is_trial ? 0 : 0.01" step="0.01" :disabled="plan.is_trial" class="w-full" /><UButton type="button" icon="i-lucide-plus" color="neutral" variant="outline" :disabled="plan.is_trial" @click="adjustMonthlyPrice(plan, 0.10)" /></UFieldGroup></UFormField>
            <UFormField name="annual_discount_percent" :label="t('admin.plans.annualDiscount')" :help="t('admin.plans.annualDiscountHelp')"><UInputNumber v-model="draft(plan).annual_discount_percent" :min="0" :max="100" :disabled="plan.is_trial" suffix="%" class="w-full" /><p class="mt-1 text-xs text-muted">{{ t('admin.plans.annualPriceHelp', { price: formatMoney(annualPrice(plan)) }) }}</p></UFormField>
            <UFormField name="posts_per_month" :label="t('admin.plans.posts')"><UInputNumber v-model="draft(plan).posts_per_month" :min="0" class="w-full" /></UFormField>
            <UFormField name="monthly_credits" :label="t('admin.plans.credits')"><UInputNumber v-model="draft(plan).monthly_credits" :min="0" class="w-full" /></UFormField>
            <UFormField name="active" :label="t('admin.plans.active')"><USwitch v-model="draft(plan).active" /></UFormField>
            <p class="self-end text-sm text-muted">{{ t('admin.plans.activeSubscriptions', { count: plan.active_subscriptions }) }}</p>
            <UButton type="submit" class="sm:col-span-2" :loading="savingPlans[plan.code]" :disabled="!Object.keys(planChanges(plan)).length || planInvalid(plan)" :label="t('admin.plans.save')" />
          </UForm>
        </UCard>
        <UTable class="hidden md:block" :data="plans" :columns="columns" :ui="{ root: 'w-full', base: 'w-full border-separate border-spacing-0', thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none', th: 'py-3 px-4 text-xs font-medium', td: 'px-4 py-3 border-b border-default text-sm', tbody: '[&>tr]:last:[&>td]:border-b-0', separator: 'h-0' }">
          <template #name-cell="{ row }"><div class="min-w-44"><UInput v-model="draft(row.original).name" maxlength="120" class="w-full" /></div></template>
          <template #price-cell="{ row }"><UFieldGroup class="w-44"><UButton type="button" icon="i-lucide-minus" color="neutral" variant="outline" size="xs" :disabled="row.original.is_trial" @click="adjustMonthlyPrice(row.original, -0.10)" /><UInput v-model.number="draft(row.original).monthly_price" type="number" :min="row.original.is_trial ? 0 : 0.01" step="0.01" :disabled="row.original.is_trial" class="w-full" /><UButton type="button" icon="i-lucide-plus" color="neutral" variant="outline" size="xs" :disabled="row.original.is_trial" @click="adjustMonthlyPrice(row.original, 0.10)" /></UFieldGroup></template>
          <template #annual-cell="{ row }"><div class="space-y-1"><UInputNumber v-model="draft(row.original).annual_discount_percent" :min="0" :max="100" :disabled="row.original.is_trial" suffix="%" class="w-24" /><p class="text-xs text-muted">{{ t('admin.plans.annualDiscountShort') }}</p><p class="text-xs text-muted">{{ t('admin.plans.annualPriceHelp', { price: formatMoney(annualPrice(row.original)) }) }}</p></div></template>
          <template #posts-cell="{ row }"><UInputNumber v-model="draft(row.original).posts_per_month" :min="0" class="w-24" /></template>
          <template #credits-cell="{ row }"><UInputNumber v-model="draft(row.original).monthly_credits" :min="0" class="w-28" /></template>
          <template #subscriptions-cell="{ row }">{{ row.original.active_subscriptions }}</template>
          <template #status-cell="{ row }"><USwitch v-model="draft(row.original).active" :aria-label="t('admin.plans.active')" /></template>
          <template #actions-cell="{ row }"><UButton size="sm" :color="Object.keys(planChanges(row.original)).length ? 'primary' : 'neutral'" :variant="Object.keys(planChanges(row.original)).length ? 'solid' : 'ghost'" :loading="savingPlans[row.original.code]" :disabled="!Object.keys(planChanges(row.original)).length || planInvalid(row.original)" :label="Object.keys(planChanges(row.original)).length ? t('admin.plans.save') : t('admin.plans.saved')" @click="savePlan(row.original)" /></template>
        </UTable>
      </UCard>

      <UCard class="shrink-0" :ui="cardUi">
        <template #header><UUser :name="t('admin.plans.pricingTitle')" :description="t('admin.plans.pricingDescription')" :avatar="{ icon: 'i-lucide-coins', size: 'sm' }" /></template>
        <UForm :state="pricing" class="grid gap-4 sm:grid-cols-3" @submit="saveSettings('pricing')">
          <UFormField name="credit_price" :label="t('admin.plans.creditPrice')" :help="t('admin.plans.creditPriceHelp')"><UInputNumber v-model="pricing.credit_price" :min="0.01" :step="0.01" :format-options="{ style: 'currency', currency: 'EUR', maximumFractionDigits: 4 }" class="w-full" /></UFormField>
          <UFormField name="provider_cost" :label="t('admin.plans.providerCost')" :help="t('admin.plans.providerCostHelp')"><UInputNumber v-model="pricing.provider_cost" :min="0.000001" :step="0.001" :format-options="{ style: 'currency', currency: 'EUR', maximumFractionDigits: 6 }" class="w-full" /></UFormField>
          <UFormField name="low_credit_threshold" :label="t('admin.plans.lowCreditThreshold')" :help="t('admin.plans.lowCreditThresholdHelp')"><UInputNumber v-model="pricing.low_credit_threshold" :min="0" class="w-full" /></UFormField>
          <UAlert class="sm:col-span-3" :color="margin > 0 ? 'neutral' : 'error'" variant="subtle" icon="i-lucide-percent" :title="t('admin.plans.margin', { margin })" />
          <UButton type="submit" class="sm:col-span-3 justify-self-start" :loading="saving.pricing" :disabled="!Object.keys(pricingChanges).length || pricingInvalid" :label="t('admin.plans.save')" />
        </UForm>
      </UCard>

      <UCard class="shrink-0" :ui="cardUi">
        <template #header><UUser :name="t('admin.plans.invoiceTitle')" :description="t('admin.plans.invoiceDescription')" :avatar="{ icon: 'i-lucide-receipt-text', size: 'sm' }" /></template>
        <UForm :state="invoice" class="grid gap-4 sm:grid-cols-2" @submit="saveSettings('invoice')">
          <UFormField name="seller_name" :label="t('admin.plans.sellerName')" required><UInput v-model="invoice.seller_name" maxlength="160" class="w-full" /></UFormField>
          <UFormField name="seller_fiscal_number" :label="t('admin.plans.sellerFiscalNumber')"><UInput v-model="invoice.seller_fiscal_number" maxlength="40" class="w-full" /></UFormField>
          <UFormField name="seller_address" :label="t('admin.plans.sellerAddress')" class="sm:col-span-2"><UInput v-model="invoice.seller_address" maxlength="240" class="w-full" /></UFormField>
          <UFormField name="number_prefix" :label="t('admin.plans.numberPrefix')" :help="t('admin.plans.numberPrefixHelp', { example: (invoice.number_prefix || 'RRIT') + '-2026-000123' })"><UInput v-model="invoice.number_prefix" maxlength="12" class="w-full uppercase" /></UFormField>
          <UFormField name="vat_percent" :label="t('admin.plans.vat')" :help="t('admin.plans.vatHelp')"><UInputNumber v-model="invoice.vat_percent" :min="0" :max="100" :step="0.01" :format-options="{ maximumFractionDigits: 2 }" class="w-full" /></UFormField>
          <UButton type="submit" class="sm:col-span-2 justify-self-start" :loading="saving.invoice" :disabled="!Object.keys(invoiceChanges).length || invoiceInvalid" :label="t('admin.plans.save')" />
        </UForm>
      </UCard>
    </template>
  </AdminPage>
</template>
