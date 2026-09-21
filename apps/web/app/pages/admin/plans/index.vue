<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { AdminPlan } from '~/components/AdminPlanEditor.vue'
import { formatMoney } from '~~/shared/utils/format'

definePageMeta({ layout: 'admin', middleware: 'superadmin' })
const { t } = useI18n()
const toast = useToast()
useSeoMeta({ title: () => `${t('admin.nav.plans')} · Rrit Admin`, robots: 'noindex, nofollow' })

type CreditPricing = { credit_price_cents: number; provider_cost_per_credit_micro_eur: number; low_credit_threshold: number }
type InvoiceSettings = {
  number_prefix: string
  seller_name: string
  seller_address: string
  seller_fiscal_number: string
  vat_rate_basis_points: number
}
const { data, error, refresh } = await useFetch<{
  plans: AdminPlan[]
  credit_pricing: CreditPricing
  invoice_settings: InvoiceSettings
}>('/api/admin/plans', { key: 'admin-plans' })
const plans = computed(() => data.value?.plans || [])
const editing = ref<AdminPlan | null>(null)

// Forms hold display units: euros and percent; the API stores cents and basis points.
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

function changed<T extends Record<string, unknown>>(current: T | undefined, next: Partial<T>) {
  return Object.fromEntries(Object.entries(next).filter(([key, value]) => current?.[key] !== value))
}
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
// What one credit earns: sale price over provider cost.
const margin = computed(() =>
  pricing.credit_price > 0 ? Math.round((1 - pricing.provider_cost / pricing.credit_price) * 100) : 0,
)

const saving = reactive({ pricing: false, invoice: false })
async function saveSettings(kind: 'pricing' | 'invoice') {
  const body = kind === 'pricing' ? pricingChanges.value : invoiceChanges.value
  if (!Object.keys(body).length) return
  saving[kind] = true
  try {
    await $fetch(`/api/admin/plans/${kind === 'pricing' ? 'credit-pricing' : 'invoice-settings'}`, { method: 'PATCH', body })
    toast.add({ title: t('admin.plans.saved'), color: 'success' })
    await refresh()
  } catch (problem) {
    toast.add({
      title: (problem as { data?: { message?: string } }).data?.message || t('admin.plans.saveFailed'),
      color: 'error',
    })
  } finally {
    saving[kind] = false
  }
}

const wide = { class: { th: 'hidden lg:table-cell', td: 'hidden lg:table-cell' } }
const columns = computed<TableColumn<AdminPlan>[]>(() => [
  { accessorKey: 'name', header: t('admin.plans.plan') },
  { id: 'price', header: t('admin.plans.monthlyPrice') },
  { id: 'posts', header: t('admin.plans.posts') },
  { id: 'credits', header: t('admin.plans.credits') },
  { id: 'style', header: t('admin.plans.styleCount'), meta: wide },
  { id: 'status', header: t('admin.plans.status') },
  { id: 'actions', header: '' },
])
const cardUi = { header: 'px-4 py-3 sm:px-5', body: 'p-4 sm:p-5' }
</script>
<template>
  <AdminPage :title="t('admin.nav.plans')">
    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      :title="t('admin.plans.loadError')"
      :actions="[{ label: t('common.retry'), variant: 'outline', onClick: () => refresh() }]"
    />
    <template v-else>
      <UCard class="shrink-0" :ui="{ header: 'px-4 py-3 sm:px-5', body: 'p-0 sm:p-0' }">
        <template #header>
          <UUser
            :name="t('admin.plans.packagesTitle')"
            :description="t('admin.plans.packagesDescription')"
            :avatar="{ icon: 'i-lucide-package', size: 'sm' }"
          />
        </template>
        <!-- Phones: one card per package. -->
        <UCard
          v-for="plan in plans"
          :key="plan.code"
          class="md:hidden"
          :ui="{ root: 'rounded-none ring-0 border-b border-default', body: 'p-4 sm:p-4 space-y-3' }"
        >
          <UUser :name="plan.name" :description="`${plan.code} · ${formatMoney(plan.monthly_cents / 100)} / ${t('billing.month')}`" />
          <UFieldGroup class="flex flex-wrap items-center gap-1.5">
            <UBadge :color="plan.active ? 'success' : 'neutral'" variant="subtle" :label="plan.active ? t('admin.plans.activeLabel') : t('admin.plans.inactiveLabel')" />
            <UBadge color="neutral" variant="soft" icon="i-lucide-file-text" :label="String(plan.posts_per_month)" />
            <UBadge color="neutral" variant="soft" icon="i-lucide-coins" :label="String(plan.monthly_credits)" />
            <UButton icon="i-lucide-pencil" color="neutral" variant="ghost" size="sm" :label="t('admin.plans.edit')" @click="editing = plan" />
          </UFieldGroup>
        </UCard>
        <UTable
          class="hidden md:block"
          :data="plans"
          :columns="columns"
          :ui="{
            root: 'w-full',
            base: 'w-full border-separate border-spacing-0',
            thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
            th: 'py-3 px-4 text-xs font-medium',
            td: 'px-4 py-3 border-b border-default text-sm',
            tbody: '[&>tr]:last:[&>td]:border-b-0',
            separator: 'h-0',
          }"
        >
          <template #name-cell="{ row }">
            <UUser :name="row.original.name" :description="row.original.code" />
          </template>
          <template #price-cell="{ row }">
            {{ formatMoney(row.original.monthly_cents / 100) }}
            <UBadge v-if="row.original.annual_discount_percent" color="neutral" variant="soft" size="sm" class="ms-1" :label="`-${row.original.annual_discount_percent}% ${t('billing.annual').toLowerCase()}`" />
          </template>
          <template #posts-cell="{ row }">{{ row.original.posts_per_month }}</template>
          <template #credits-cell="{ row }">{{ row.original.monthly_credits }}</template>
          <template #style-cell="{ row }">{{ row.original.style_fetch_post_count }}</template>
          <template #status-cell="{ row }">
            <UBadge
              :color="row.original.active ? 'success' : 'neutral'"
              variant="subtle"
              :label="row.original.active ? t('admin.plans.activeLabel') : t('admin.plans.inactiveLabel')"
            />
            <UBadge v-if="row.original.is_trial" color="info" variant="subtle" class="ms-1" label="Trial" />
          </template>
          <template #actions-cell="{ row }">
            <UButton
              icon="i-lucide-pencil"
              color="neutral"
              variant="ghost"
              :aria-label="t('admin.plans.editTitle', { name: row.original.name })"
              @click="editing = row.original"
            />
          </template>
        </UTable>
      </UCard>

      <UCard class="shrink-0" :ui="cardUi">
        <template #header>
          <UUser
            :name="t('admin.plans.pricingTitle')"
            :description="t('admin.plans.pricingDescription')"
            :avatar="{ icon: 'i-lucide-coins', size: 'sm' }"
          />
        </template>
        <UForm :state="pricing" class="grid gap-4 sm:grid-cols-3" @submit="saveSettings('pricing')">
          <UFormField name="credit_price" :label="t('admin.plans.creditPrice')" :help="t('admin.plans.creditPriceHelp')">
            <UInputNumber v-model="pricing.credit_price" :min="0.01" :step="0.01" :format-options="{ style: 'currency', currency: 'EUR', maximumFractionDigits: 4 }" class="w-full" />
          </UFormField>
          <UFormField name="provider_cost" :label="t('admin.plans.providerCost')" :help="t('admin.plans.providerCostHelp')">
            <UInputNumber v-model="pricing.provider_cost" :min="0.000001" :step="0.001" :format-options="{ style: 'currency', currency: 'EUR', maximumFractionDigits: 6 }" class="w-full" />
          </UFormField>
          <UFormField name="low_credit_threshold" :label="t('admin.plans.lowCreditThreshold')" :help="t('admin.plans.lowCreditThresholdHelp')">
            <UInputNumber v-model="pricing.low_credit_threshold" :min="0" class="w-full" />
          </UFormField>
          <UAlert
            class="sm:col-span-3"
            :color="margin > 0 ? 'neutral' : 'error'"
            variant="subtle"
            icon="i-lucide-percent"
            :title="t('admin.plans.margin', { margin })"
          />
          <UButton
            type="submit"
            class="sm:col-span-3 justify-self-start"
            :loading="saving.pricing"
            :disabled="!Object.keys(pricingChanges).length"
            :label="t('admin.plans.save')"
          />
        </UForm>
      </UCard>

      <UCard class="shrink-0" :ui="cardUi">
        <template #header>
          <UUser
            :name="t('admin.plans.invoiceTitle')"
            :description="t('admin.plans.invoiceDescription')"
            :avatar="{ icon: 'i-lucide-receipt-text', size: 'sm' }"
          />
        </template>
        <UForm :state="invoice" class="grid gap-4 sm:grid-cols-2" @submit="saveSettings('invoice')">
          <UFormField name="seller_name" :label="t('admin.plans.sellerName')" required>
            <UInput v-model="invoice.seller_name" maxlength="160" class="w-full" />
          </UFormField>
          <UFormField name="seller_fiscal_number" :label="t('admin.plans.sellerFiscalNumber')">
            <UInput v-model="invoice.seller_fiscal_number" maxlength="40" class="w-full" />
          </UFormField>
          <UFormField name="seller_address" :label="t('admin.plans.sellerAddress')" class="sm:col-span-2">
            <UInput v-model="invoice.seller_address" maxlength="240" class="w-full" />
          </UFormField>
          <UFormField name="number_prefix" :label="t('admin.plans.numberPrefix')" :help="t('admin.plans.numberPrefixHelp', { example: `${invoice.number_prefix || 'RRIT'}-2026-000123` })">
            <UInput v-model="invoice.number_prefix" maxlength="12" class="w-full uppercase" />
          </UFormField>
          <UFormField name="vat_percent" :label="t('admin.plans.vat')" :help="t('admin.plans.vatHelp')">
            <UInputNumber v-model="invoice.vat_percent" :min="0" :max="100" :step="0.01" :format-options="{ maximumFractionDigits: 2 }" class="w-full" />
          </UFormField>
          <UButton
            type="submit"
            class="sm:col-span-2 justify-self-start"
            :loading="saving.invoice"
            :disabled="!Object.keys(invoiceChanges).length"
            :label="t('admin.plans.save')"
          />
        </UForm>
      </UCard>
    </template>
    <AdminPlanEditor :plan="editing" @close="editing = null" @saved="refresh()" />
  </AdminPage>
</template>
