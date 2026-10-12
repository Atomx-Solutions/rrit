<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'superadmin' })

type CreditPricing = { credit_price_cents: number, provider_cost_per_credit_micro_eur: number, low_credit_threshold: number, video_credits: number }
type InvoiceSettings = { number_prefix: string, seller_name: string, seller_address: string, seller_fiscal_number: string, vat_rate_basis_points: number }
type TrialPlan = { code: string, name: string, posts_per_month: number, videos_per_month: number, active: boolean, is_trial: boolean }

const { t } = useI18n()
const toast = useToast()
const { onFormError, showError } = useFormFeedback()
useSeoMeta({ title: () => t('admin.nav.billingSettings'), robots: 'noindex, nofollow' })
const { data, error, refresh } = await useFetch<{
  plans: TrialPlan[]
  credit_pricing: CreditPricing
  invoice_settings: InvoiceSettings
}>('/api/admin/plans', { lazy: true, key: 'admin-billing-settings' })
// How many credits a package post is funded with lives with the platform
// settings, not with the credit pricing, but it belongs on this screen: it is
// the third number that decides what a post costs the business.
const { data: platform, refresh: refreshPlatform } = await useFetch<{
  custom_package_credits_per_post: number
  custom_package_post_price_cents: number
  custom_package_video_price_cents: number
}>('/api/admin/settings', { lazy: true, key: 'admin-platform-package-pricing' })
watch(error, (value) => {
  if (value) showError(t('admin.plans.loadError'))
}, { immediate: true })

function changed<T extends Record<string, unknown>>(current: T | undefined, next: Partial<T>) {
  return Object.fromEntries(Object.entries(next).filter(([key, value]) => current?.[key] !== value))
}

const pricing = reactive({ credit_price: 0, provider_cost: 0, low_credit_threshold: 0, video_credits: 5 })
const trial = reactive({ posts_per_month: 0, videos_per_month: 0, active: true })
const freeTrial = computed(() => data.value?.plans.find(plan => plan.code === 'free-trial'))
watch(freeTrial, (value) => {
  if (!value) return
  trial.posts_per_month = value.posts_per_month
  trial.videos_per_month = value.videos_per_month
  trial.active = value.active
}, { immediate: true })
const trialChanges = computed(() => changed(freeTrial.value, trial))
const creditsPerPost = ref(0)
// What a post sells for. The public page quotes it before anyone fills in a
// form, so it belongs beside the other prices rather than on a general
// settings screen.
const postPriceChf = ref(0)
const videoPriceChf = ref(2)
watch(platform, (value) => {
  if (!value) return
  creditsPerPost.value = value.custom_package_credits_per_post
  postPriceChf.value = value.custom_package_post_price_cents / 100
  videoPriceChf.value = value.custom_package_video_price_cents / 100
}, { immediate: true })
const postPriceCents = computed(() => Math.round(Number(postPriceChf.value) * 100))
const platformChanges = computed(() => {
  if (!platform.value) return {}
  return {
    ...(Number(creditsPerPost.value) !== platform.value.custom_package_credits_per_post
      ? { custom_package_credits_per_post: Number(creditsPerPost.value) }
      : {}),
    ...(postPriceCents.value !== platform.value.custom_package_post_price_cents
      ? { custom_package_post_price_cents: postPriceCents.value }
      : {}),
    ...(Math.round(Number(videoPriceChf.value) * 100) !== platform.value.custom_package_video_price_cents
      ? { custom_package_video_price_cents: Math.round(Number(videoPriceChf.value) * 100) }
      : {}),
  }
})
const invoice = reactive({ number_prefix: '', seller_name: '', seller_address: '', seller_fiscal_number: '', vat_percent: 0 })
watch(data, (value) => {
  if (!value) return
  Object.assign(pricing, {
    credit_price: value.credit_pricing.credit_price_cents / 100,
    provider_cost: value.credit_pricing.provider_cost_per_credit_micro_eur / 1_000_000,
    low_credit_threshold: value.credit_pricing.low_credit_threshold,
    video_credits: value.credit_pricing.video_credits,
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
  video_credits: Number(pricing.video_credits),
}))
const invoiceChanges = computed(() => changed(data.value?.invoice_settings, {
  number_prefix: invoice.number_prefix.trim().toUpperCase(),
  seller_name: invoice.seller_name.trim(),
  seller_address: invoice.seller_address.trim(),
  seller_fiscal_number: invoice.seller_fiscal_number.trim(),
  vat_rate_basis_points: Math.round(Number(invoice.vat_percent) * 100),
}))
const margin = computed(() => pricing.credit_price > 0 ? Math.round((1 - pricing.provider_cost / pricing.credit_price) * 100) : 0)
const pricingInvalid = computed(() =>
  pricing.credit_price <= 0
  || pricing.provider_cost <= 0
  || pricing.low_credit_threshold < 0
  || Number(creditsPerPost.value) < 1
  || Number(pricing.video_credits) < 1
  || postPriceCents.value < 1
  || Number(videoPriceChf.value) <= 0,
)
const invoiceInvalid = computed(() => invoice.vat_percent < 0 || invoice.vat_percent > 100 || !invoice.seller_name.trim())
const saving = reactive({ pricing: false, invoice: false, trial: false })

async function saveTrial() {
  if (!Object.keys(trialChanges.value).length) return
  saving.trial = true
  try {
    await $fetch('/api/admin/plans/trial', { method: 'PATCH', body: trialChanges.value })
    toast.add({ title: t('admin.plans.saved'), color: 'success' })
    await refresh()
  } catch (problem) {
    toast.add({ title: (problem as { data?: { message?: string } }).data?.message || 'admin.plans.saveFailed', color: 'error' })
  } finally {
    saving.trial = false
  }
}

async function saveSettings(kind: 'pricing' | 'invoice') {
  const body = kind === 'pricing' ? pricingChanges.value : invoiceChanges.value
  // The card edits two stores, so it may have nothing to say to one of them.
  const alsoPlatform = kind === 'pricing' && Object.keys(platformChanges.value).length > 0
  if (
    (!Object.keys(body).length && !alsoPlatform)
    || (kind === 'pricing' ? pricingInvalid.value : invoiceInvalid.value)
  ) return
  saving[kind] = true
  try {
    if (Object.keys(body).length)
      await $fetch(kind === 'pricing' ? '/api/admin/plans/credit-pricing' : '/api/admin/plans/invoice-settings', { method: 'PATCH', body })
    if (alsoPlatform)
      await $fetch('/api/admin/settings', { method: 'PATCH', body: platformChanges.value })
    toast.add({ title: t('admin.plans.saved'), color: 'success' })
    await Promise.all([refresh(), refreshPlatform()])
  } catch (problem) {
    toast.add({ title: (problem as { data?: { message?: string } }).data?.message || 'admin.plans.saveFailed', color: 'error' })
  } finally {
    saving[kind] = false
  }
}

const cardUi = { header: 'px-4 py-3 sm:px-5', body: 'p-4 sm:p-5' }
</script>

<template>
  <AdminPage :title="t('admin.nav.billingSettings')">
      <UCard v-if="freeTrial" class="shrink-0" :ui="cardUi">
        <template #header><UUser :name="freeTrial.name" :description="t('admin.plans.trialDescription')" :avatar="{ icon: 'i-lucide-gift', size: 'sm' }" /></template>
        <UForm :state="trial" class="grid gap-4 sm:grid-cols-2" @submit="saveTrial" @error="onFormError">
          <UFormField name="posts_per_month" :label="t('admin.plans.posts')" :help="t('admin.plans.trialPostsHelp')"><UInputNumber v-model="trial.posts_per_month" :min="0" :max="10000" class="w-full" /></UFormField>
          <UFormField name="videos_per_month" :label="t('admin.plans.videos')" :help="t('admin.plans.trialVideosHelp')"><UInputNumber v-model="trial.videos_per_month" :min="0" :max="10000" class="w-full" /></UFormField>
          <UFormField name="active" :label="t('admin.plans.active')" :help="t('admin.plans.trialActiveHelp')"><USwitch v-model="trial.active" /></UFormField>
          <UButton type="submit" class="sm:col-span-2 justify-self-start" :loading="saving.trial" :disabled="!Object.keys(trialChanges).length" :label="t('admin.plans.save')" />
        </UForm>
      </UCard>
      <UCard class="shrink-0" :ui="cardUi">
        <template #header><UUser :name="t('admin.plans.pricingTitle')" :description="t('admin.plans.pricingDescription')" :avatar="{ icon: 'i-lucide-coins', size: 'sm' }" /></template>
        <UForm :state="pricing" class="grid gap-4 sm:grid-cols-2" @submit="saveSettings('pricing')" @error="onFormError">
          <!-- What a credit costs and is worth, then the photo settings, then
               the video ones, so each subject is read in one place. -->
          <UFormField name="credit_price" :label="t('admin.plans.creditPrice')" :help="t('admin.plans.creditPriceHelp')"><UInputNumber v-model="pricing.credit_price" :min="0.01" :step="0.01" :format-options="{ style: 'currency', currency: 'EUR', maximumFractionDigits: 4 }" class="w-full" /></UFormField>
          <UFormField name="provider_cost" :label="t('admin.plans.providerCost')" :help="t('admin.plans.providerCostHelp')"><UInputNumber v-model="pricing.provider_cost" :min="0.000001" :step="0.001" :format-options="{ style: 'currency', currency: 'EUR', maximumFractionDigits: 6 }" class="w-full" /></UFormField>
          <UFormField name="low_credit_threshold" :label="t('admin.plans.lowCreditThreshold')" :help="t('admin.plans.lowCreditThresholdHelp')" class="sm:col-span-2"><UInputNumber v-model="pricing.low_credit_threshold" :min="0" class="w-full" /></UFormField>
          <UFormField name="post_price_chf" :label="'Post-Preis (CHF)'" :help="t('admin.settings.postPriceHint')"><UInputNumber v-model="postPriceChf" :min="0.01" :step="0.01" :format-options="{ style: 'currency', currency: 'CHF', maximumFractionDigits: 2 }" class="w-full" /></UFormField>
          <UFormField name="credits_per_post" :label="t('admin.settings.creditsPerPost')" :help="t('admin.settings.creditsPerPostHint')"><UInputNumber v-model="creditsPerPost" :min="1" :max="100000" class="w-full" /></UFormField>
          <UFormField name="video_price_chf" :label="'Video-Preis (CHF)'" :help="t('admin.settings.videoPriceHint')"><UInputNumber v-model="videoPriceChf" :min="0.01" :step="0.01" :format-options="{ style: 'currency', currency: 'CHF', maximumFractionDigits: 2 }" class="w-full" /></UFormField>
          <UFormField name="video_credits" :label="t('admin.plans.tiktokVideoCredits')" :help="t('admin.plans.tiktokVideoCreditsHelp')"><UInputNumber v-model="pricing.video_credits" :min="1" :max="100000" class="w-full" /></UFormField>
          <UAlert class="sm:col-span-2" :color="margin > 0 ? 'neutral' : 'error'" variant="subtle" icon="i-lucide-percent" :title="t('admin.plans.margin', { margin })" />
          <UButton type="submit" class="sm:col-span-2 justify-self-start" :loading="saving.pricing" :disabled="(!Object.keys(pricingChanges).length && !Object.keys(platformChanges).length) || pricingInvalid" :label="t('admin.plans.save')" />
        </UForm>
      </UCard>

      <UCard class="shrink-0" :ui="cardUi">
        <template #header><UUser :name="t('admin.plans.invoiceTitle')" :description="t('admin.plans.invoiceDescription')" :avatar="{ icon: 'i-lucide-receipt-text', size: 'sm' }" /></template>
        <UForm :state="invoice" class="grid gap-4 sm:grid-cols-2" @submit="saveSettings('invoice')" @error="onFormError">
          <UFormField name="seller_name" :label="t('admin.plans.sellerName')" required><UInput v-model="invoice.seller_name" maxlength="160" class="w-full" /></UFormField>
          <UFormField name="seller_fiscal_number" :label="t('admin.plans.sellerFiscalNumber')"><UInput v-model="invoice.seller_fiscal_number" maxlength="40" class="w-full" /></UFormField>
          <UFormField name="seller_address" :label="t('admin.plans.sellerAddress')" class="sm:col-span-2"><UInput v-model="invoice.seller_address" maxlength="240" class="w-full" /></UFormField>
          <UFormField name="number_prefix" :label="t('admin.plans.numberPrefix')" :help="t('admin.plans.numberPrefixHelp', { example: (invoice.number_prefix || 'FRAMIC') + '-2026-000123' })"><UInput v-model="invoice.number_prefix" maxlength="12" class="w-full uppercase" /></UFormField>
          <UFormField name="vat_percent" :label="t('admin.plans.vat')" :help="t('admin.plans.vatHelp')"><UInputNumber v-model="invoice.vat_percent" :min="0" :max="100" :step="0.01" :format-options="{ maximumFractionDigits: 2 }" class="w-full" /></UFormField>
          <UButton type="submit" class="sm:col-span-2 justify-self-start" :loading="saving.invoice" :disabled="!Object.keys(invoiceChanges).length || invoiceInvalid" :label="t('admin.plans.save')" />
        </UForm>
      </UCard>
  </AdminPage>
</template>
