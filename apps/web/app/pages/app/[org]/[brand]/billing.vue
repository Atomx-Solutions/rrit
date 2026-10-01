<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'workspace' })

const { t } = useI18n()
const { showError, showSuccess, onFormError } = useFormFeedback()
useSeoMeta({ title: () => `${t('nav.billing')} · Rrit` })

const { data: usage, error: usageError, refresh: refreshUsage } = await useFetch('/api/usage', { key: 'usage' })
const { data: billing, refresh: refreshBilling } = await useFetch('/api/billing/subscription', { key: 'billing-subscription' })
const { data: billingDetailsData, refresh: refreshDetails } = await useFetch('/api/billing/details', { key: 'billing-details' })

const detailsForm = reactive({ legalName: '', address: '', city: '', country: '', fiscalNumber: '' })
const savingDetails = ref(false)
const requestOpen = ref(false)
const acceptingProposal = ref(false)
const decliningProposal = ref(false)
watch(() => billingDetailsData.value?.details, (details) => {
  if (details) Object.assign(detailsForm, details)
}, { immediate: true })
watch(usageError, (value) => {
  if (value) showError(t('billing.usageLoadError'), 'warning')
}, { immediate: true })

const customPackage = computed(() => billing.value?.customPackage || null)
const packageProposal = computed(() => billing.value?.packageProposal || null)
const subscription = computed(() => billing.value?.subscription || null)
const postsUsage = computed(() => usage.value?.usage.find(item => item.key === 'posts_per_month'))

function formatPeriodDate(value: string) {
  return new Intl.DateTimeFormat('sq-XK', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Belgrade',
  }).format(new Date(value))
}
function usageValue(key: string, value: number) {
  if (key === 'media_storage_bytes') {
    const megabytes = value / 1024 / 1024
    return `${megabytes >= 100 ? Math.round(megabytes) : megabytes.toFixed(1)} MB`
  }
  return new Intl.NumberFormat('sq-AL').format(value)
}
const usageLabels: Record<string, string> = {
  posts_per_month: 'billing.usagePosts', ai_requests_per_day: 'billing.usageAi',
  media_storage_bytes: 'billing.usageStorage', social_accounts: 'billing.usageSocial', members: 'billing.usageMembers',
}
async function saveDetails() {
  savingDetails.value = true
  try {
    await $fetch('/api/billing/details', { method: 'PUT', body: { ...detailsForm } })
    await refreshDetails()
    showSuccess(t('billing.detailsSaved'))
  } catch {
    showError(t('billing.detailsFailed'))
  } finally {
    savingDetails.value = false
  }
}
async function acceptProposal() {
  acceptingProposal.value = true
  try {
    await $fetch('/api/billing/custom-package-accept', { method: 'POST', body: {} })
    // The accepted package grants its post-based credits atomically. Refresh
    // every visible balance immediately instead of waiting for polling.
    await Promise.all([refreshBilling(), refreshUsage(), refreshNuxtData('header-credit-balance')])
    showSuccess(t('billing.packageProposalAccepted'))
  } catch (error) {
    showError((error as { data?: { message?: string } }).data?.message || t('billing.packageProposalFailed'))
  } finally {
    acceptingProposal.value = false
  }
}
async function declineProposal() {
  decliningProposal.value = true
  try {
    await $fetch('/api/billing/custom-package-decline', { method: 'POST', body: {} })
    await refreshBilling()
    showSuccess(t('billing.packageProposalDeclined'))
  } catch (error) {
    showError((error as { data?: { message?: string } }).data?.message || t('billing.packageProposalFailed'))
  } finally { decliningProposal.value = false }
}
</script>

<template>
  <DashboardPage :title="t('nav.billing')" :description="t('billing.description')">
    <UAlert
      color="neutral"
      variant="subtle"
      icon="i-lucide-info"
      :title="t('billing.activationByTeam')"
      :description="t('billing.activationByTeamDescription')"
    />

    <UCard v-if="packageProposal" color="primary" variant="subtle" :ui="{ body: 'p-4 sm:p-5' }">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div class="space-y-1">
          <div class="flex items-center gap-2"><UIcon name="i-lucide-handshake" class="size-5 text-primary" /><h2 class="text-sm font-semibold">{{ t('billing.packageProposalTitle') }}</h2></div>
          <p class="text-sm font-medium">{{ packageProposal.name }} · €{{ packageProposal.price.toFixed(2) }}</p>
          <p class="text-xs text-muted">{{ t('billing.customPackagePosts', { count: packageProposal.postsIncluded }) }} · {{ t('billing.customPackagePeriod', { start: formatPeriodDate(packageProposal.startsAt), end: formatPeriodDate(packageProposal.endsAt) }) }}</p>
        </div>
        <div class="flex gap-2">
          <UButton color="neutral" variant="outline" :loading="decliningProposal" :label="t('billing.packageProposalDecline')" @click="declineProposal" />
          <UButton icon="i-lucide-check" :loading="acceptingProposal" :label="t('billing.packageProposalAccept')" @click="acceptProposal" />
        </div>
      </div>
    </UCard>

    <UCard v-if="customPackage" :ui="{ body: 'p-4 sm:p-5 flex items-start gap-4' }">
      <UIcon name="i-lucide-handshake" class="size-5 shrink-0 text-primary mt-0.5" />
      <div class="space-y-1">
        <h2 class="text-sm font-semibold">{{ t('billing.customPackageActive') }}</h2>
        <p class="text-sm font-medium">{{ customPackage.name }}</p>
        <p class="text-sm text-muted">{{ t('billing.customPackagePosts', { count: customPackage.postsIncluded }) }}</p>
        <p class="text-xs text-muted" data-testid="custom-package-end">
          {{ t('billing.customPackagePeriod', { start: formatPeriodDate(customPackage.startsAt), end: formatPeriodDate(customPackage.endsAt) }) }}
        </p>
        <p class="text-xs text-muted" data-testid="custom-package-usage">
          {{ t('billing.customPackageUsage', { used: customPackage.usedPosts, included: customPackage.postsIncluded, remaining: customPackage.remainingPosts }) }}
        </p>
        <p class="text-xs text-muted" data-testid="custom-package-days-remaining">
          {{ t('billing.customPackageDaysRemaining', { count: customPackage.remainingDays }) }}
        </p>
        <p class="text-xs text-muted">{{ t('billing.customPackageContact') }}</p>
      </div>
    </UCard>

    <UCard v-else :ui="{ body: 'p-4 sm:p-5 flex items-start gap-4' }">
      <UIcon name="i-lucide-credit-card" class="size-5 shrink-0 text-muted mt-0.5" />
      <div class="space-y-1">
        <h2 class="text-sm font-semibold">{{ t('billing.serviceActive') }}</h2>
        <p v-if="subscription" class="text-sm font-medium">{{ t('billing.currentPlan', { plan: subscription.planCode }) }}</p>
        <p v-if="subscription" class="text-xs text-muted">
          {{ t('billing.validUntil', { date: formatPeriodDate(subscription.periodEnd), interval: subscription.interval === 'annual' ? t('billing.annual').toLowerCase() : t('billing.monthly').toLowerCase() }) }}
        </p>
      </div>
    </UCard>

    <!-- Packages are activated by the team, so the invitation lives here as
         a real card and the form opens in a modal on demand. -->
    <UCard as="section" :ui="{ body: 'p-5 sm:p-6' }">
      <div class="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div class="flex gap-4">
          <div class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <UIcon name="i-lucide-package-plus" class="size-5" />
          </div>
          <div class="space-y-2">
            <h2 class="text-base font-semibold">
              {{ customPackage ? t('request.appRenewTitle') : t('request.appTitle') }}
            </h2>
            <p class="text-sm font-medium">{{ t('request.appLede') }}</p>
            <p class="text-sm text-muted leading-relaxed">{{ t('request.appBody') }}</p>
            <p class="pt-1 text-xs text-muted flex items-center gap-1.5">
              <UIcon name="i-lucide-clock-3" class="size-3.5" />
              {{ t('request.appNote') }}
            </p>
          </div>
        </div>
        <UModal v-model:open="requestOpen" :title="customPackage ? t('request.appRenewTitle') : t('request.appTitle')">
          <UButton
            color="primary"
            variant="solid"
            trailing-icon="i-lucide-arrow-right"
            :label="customPackage ? t('request.appRenewCta') : t('request.appCta')"
            class="self-start whitespace-nowrap sm:self-auto"
          />
          <template #body>
            <PackageRequestForm endpoint="/api/billing/package-request" compact contact-known @sent="requestOpen = false" />
          </template>
        </UModal>
      </div>
    </UCard>

    <template v-if="usage">
      <UCard :ui="{ body: 'p-4' }">
        <div class="flex items-center justify-between gap-4">
          <div class="flex min-w-0 items-center gap-3">
            <div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <UIcon name="i-lucide-sparkles" class="size-4 text-primary" />
            </div>
            <div><h2 class="text-sm font-semibold">{{ t('billing.credits') }}</h2><p class="text-xs text-muted">{{ t('billing.creditsDescription') }}</p></div>
          </div>
          <p class="shrink-0 text-sm font-semibold tabular-nums" data-testid="credit-balance">{{ usage.credits.remaining }} <span class="text-xs font-normal text-muted">{{ t('billing.creditsUnit') }}</span></p>
        </div>
      </UCard>
      <UAlert v-if="usage.credits.spendable === 0" color="warning" variant="outline" icon="i-lucide-circle-alert" :title="t('billing.creditsExhausted')" />
      <UCard as="section" :ui="{ body: 'p-4' }">
        <div class="mb-5"><h2 class="text-sm font-semibold">{{ t('billing.currentUsage') }}</h2><p class="text-sm text-muted mt-1">{{ t('billing.currentUsageDescription') }}</p><p v-if="postsUsage" class="text-sm font-medium mt-2">{{ t('billing.postsRemaining', { count: usageValue('posts_per_month', postsUsage.remaining) }) }}</p></div>
        <div class="grid gap-5 sm:grid-cols-2">
          <div v-for="item in usage.usage" :key="item.key" class="space-y-2">
            <div class="flex items-center justify-between gap-3 text-sm"><span>{{ t(usageLabels[item.key] || item.key) }}</span><span class="tabular-nums text-muted">{{ usageValue(item.key, item.current) }} / {{ usageValue(item.key, item.limit) }}</span></div>
            <UProgress :model-value="item.percentage" :color="item.state === 'exhausted' ? 'error' : item.state === 'warning' ? 'warning' : 'primary'" />
          </div>
        </div>
      </UCard>
    </template>

    <UCard id="billing-details" as="section" :ui="{ body: 'p-4 sm:p-5', header: 'px-5 py-4' }">
      <template #header><h2 class="text-sm font-semibold">{{ t('billing.detailsTitle') }}</h2><p class="text-xs text-muted mt-1">{{ t('billing.detailsDescription') }}</p></template>
      <UForm :state="detailsForm" class="grid gap-3 sm:grid-cols-2" @submit="saveDetails" @error="onFormError">
        <UFormField name="legalName" :label="t('billing.detailsLegalName')" required><UInput v-model="detailsForm.legalName" class="w-full" maxlength="160" /></UFormField>
        <UFormField name="fiscalNumber" :label="t('billing.detailsFiscalNumber')" :hint="t('billing.detailsOptional')"><UInput v-model="detailsForm.fiscalNumber" class="w-full" maxlength="40" /></UFormField>
        <UFormField name="address" :label="t('billing.detailsAddress')" class="sm:col-span-2"><UInput v-model="detailsForm.address" class="w-full" maxlength="240" /></UFormField>
        <UFormField name="city" :label="t('billing.detailsCity')"><UInput v-model="detailsForm.city" class="w-full" maxlength="120" /></UFormField>
        <UFormField name="country" :label="t('billing.detailsCountry')"><UInput v-model="detailsForm.country" class="w-full" maxlength="120" /></UFormField>
        <div class="sm:col-span-2"><UButton type="submit" :loading="savingDetails" icon="i-lucide-save">{{ t('billing.detailsSave') }}</UButton></div>
      </UForm>
    </UCard>
  </DashboardPage>
</template>
