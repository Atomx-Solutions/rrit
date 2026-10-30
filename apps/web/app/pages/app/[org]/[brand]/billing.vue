<script setup lang="ts">
import { DEFAULT_PACKAGE_REQUEST } from '~~/shared/utils/package-defaults'

definePageMeta({ layout: 'dashboard', middleware: 'workspace' })

const { t } = useI18n()
const runtimeConfig = useRuntimeConfig()
type PaddleEvent = { name?: string }
type PaddleApi = { Initialize: (options: { token: string; eventCallback?: (event: PaddleEvent) => void }) => void; Environment: { set: (environment: 'sandbox' | 'production') => void }; Checkout: { open: (options: { transactionId: string; settings?: { showAddDiscounts: boolean } }) => void } }
declare global { interface Window { Paddle?: PaddleApi } }
useHead({ script: [{ src: 'https://cdn.paddle.com/paddle/v2/paddle.js', defer: true }] })
const paddleReady = ref(false)
function initializePaddle() {
  const token = String(runtimeConfig.public.paddleClientToken || '')
  if (!token || !window.Paddle || paddleReady.value) return
  if (runtimeConfig.public.paddleEnvironment === 'sandbox') window.Paddle.Environment.set('sandbox')
  window.Paddle.Initialize({
    token,
    eventCallback: (event) => {
      if (event.name === 'checkout.completed') {
        // The payment is already approved by Paddle. Hide the stale offer
        // immediately; the package, quotas and credits are refreshed while
        // the webhook finishes in the background.
        paidProposalId.value = packageProposal.value?.id ?? null
        void refreshAfterPayment()
      }
    },
  })
  paddleReady.value = true
}
onMounted(() => {
  initializePaddle()
  if (!paddleReady.value) {
    const timer = window.setInterval(() => {
      initializePaddle()
      if (paddleReady.value) window.clearInterval(timer)
    }, 100)
    window.setTimeout(() => window.clearInterval(timer), 10000)
  }
})
const formatMoney = (value: number) => new Intl.NumberFormat('sq-XK', { style: 'currency', currency: billing.value?.currency || 'CHF' }).format(value)
const { showError, showSuccess } = useFormFeedback()
useSeoMeta({ title: () => `${t('nav.billing')} · Framic` })

const { data: usage, error: usageError, refresh: refreshUsage } = await useFetch('/api/usage', { lazy: true, key: 'usage' })
const { data: billing, refresh: refreshBilling } = await useFetch('/api/billing/subscription', { lazy: true, key: 'billing-subscription-currency-v2' })
const { data: platformPricing } = await useFetch<{ videoPriceCents: number; postPriceCents: number }>('/api/package-requests', { lazy: true, key: 'package-pricing' })

const requestOpen = ref(false)
const postRequestOpen = ref(false)
const postsRequested = ref(DEFAULT_PACKAGE_REQUEST.posts)
const sendingPostRequest = ref(false)
const videoRequestOpen = ref(false)
const videosRequested = ref(1)
const sendingVideoRequest = ref(false)
const creditRequestOpen = ref(false)
// The low-credit reminder asks for a request dialog, from this page or another
// one; a direct link with ?request= does the same.
const route = useRoute()
const { pending: pendingRequest } = useBillingRequest()
function openRequested(request: unknown) {
  // Opened after the click that asked for it, so that click does not count as
  // a click outside the dialog and close it again.
  setTimeout(() => {
    if (request === 'credits') creditRequestOpen.value = true
    if (request === 'package') requestOpen.value = true
  }, 0)
}
onMounted(() => {
  openRequested(pendingRequest.value?.request ?? route.query.request)
  pendingRequest.value = null
  // The request is a one-time instruction: drop it from the address so a
  // reload or a shared link does not open the dialog again.
  if (route.query.request) {
    const { request: _request, ...query } = route.query
    void navigateTo({ query }, { replace: true })
  }
})
watch(pendingRequest, (asked) => {
  if (!asked) return
  openRequested(asked.request)
  pendingRequest.value = null
})
const offerOpen = ref(false)
const paidProposalId = ref<string | null>(null)
const creditsRequested = ref(500)
const creditMessage = ref('')
const sendingCreditRequest = ref(false)
const payingProposal = ref(false)
const decliningProposal = ref(false)
const preparedProposalId = ref<string | null>(null)
const preparedTransactionId = ref<string | null>(null)
let prepareProposalPromise: Promise<string> | null = null
let offerCloseResolve: (() => void) | null = null
function waitForOfferClose() {
  if (!offerOpen.value) return Promise.resolve()
  return new Promise<void>((resolve) => {
    offerCloseResolve = resolve
  })
}
function onOfferAfterLeave() {
  offerCloseResolve?.()
  offerCloseResolve = null
}
// Pages are kept alive, so this page's watchers keep running after leaving it.
// The usage the header refreshes elsewhere (or that fails on onboarding, where
// there is no business yet) must not raise this page's warning there.
const pageActive = ref(true)
onActivated(() => { pageActive.value = true })
onDeactivated(() => { pageActive.value = false })
watch(usageError, (value) => {
  if (value && pageActive.value) showError(t('billing.usageLoadError'), 'warning')
}, { immediate: true })

const customPackage = computed(() => billing.value?.customPackage || null)
const { data: headerUsage } = useHeaderUsage()
const creditBalance = computed(() => headerUsage.value?.credits?.remaining)
const serverPackageProposal = computed(() => billing.value?.packageProposal || null)
// Videos and credits are only sold on top of a running package, so without one
// only an offer with posts is shown.
const packageProposal = computed(() => {
  const proposal = serverPackageProposal.value
  if (proposal && !customPackage.value && proposal.postsIncluded === 0) return null
  return proposal && proposal.id !== paidProposalId.value ? proposal : null
})
watch(serverPackageProposal, (proposal) => {
  if (!proposal || proposal.id !== paidProposalId.value) paidProposalId.value = null
  if (!proposal || proposal.id !== preparedProposalId.value) {
    preparedProposalId.value = null
    preparedTransactionId.value = null
  }
}, { immediate: true })
// The offer names only what it actually carries, so a video offer never reads
// as a credit top-up and a post package never claims videos it does not have.
// The translations carry no plural rules, so one item takes its own key.
const countLabel = (one: string, many: string, count: number) => t(count === 1 ? one : many, { count })
const proposalParts = computed(() => {
  const proposal = packageProposal.value
  if (!proposal) return []
  const parts: { icon: string; label: string }[] = []
  if (proposal.postsIncluded > 0)
    parts.push({ icon: 'i-lucide-image', label: countLabel('billing.proposalPost', 'billing.proposalPosts', proposal.postsIncluded) })
  if ((proposal.videosIncluded ?? 0) > 0)
    parts.push({ icon: 'i-lucide-clapperboard', label: countLabel('billing.proposalVideo', 'billing.proposalVideos', proposal.videosIncluded) })
  if (proposal.creditsIncluded > 0)
    parts.push({ icon: 'i-lucide-coins', label: t('billing.proposalCredits', { count: proposal.creditsIncluded }) })
  // Only posts and videos carry a period of their own; credits join the package
  // that is already running, so dates would be misleading on a pure top-up.
  if ((proposal.postsIncluded > 0 || (proposal.videosIncluded ?? 0) > 0) && proposal.startsAt && proposal.endsAt)
    parts.push({ icon: 'i-lucide-calendar-range', label: t('billing.customPackagePeriod', {
      start: formatPeriodDate(proposal.startsAt),
      end: formatPeriodDate(proposal.endsAt),
    }) })
  return parts
})
const proposalSummary = computed(() => proposalParts.value.map(part => part.label).join(' · '))
const creditPrice = computed(() => billing.value?.creditPrice || 0)
// Credits are bought for the package that is running, so the offer only makes
// sense to someone who has one.
const canBuyCredits = computed(() => !!customPackage.value)
const videoPrice = computed(() => ((platformPricing.value?.videoPriceCents ?? 200) / 100) * (billing.value?.exchangeRate || 1))
const postPrice = computed(() => ((platformPricing.value?.postPriceCents ?? 0) / 100) * (billing.value?.exchangeRate || 1))
// With a package running, posts are added to it rather than asking for a new
// package, so this request carries posts only.
async function sendPostRequest() {
  if (sendingPostRequest.value || postsRequested.value < 1) return
  sendingPostRequest.value = true
  postRequestOpen.value = false
  try {
    await $fetch('/api/billing/package-request', { method: 'POST', body: { postsRequested: postsRequested.value, videosRequested: 0 } })
    showSuccess(t('billing.postRequestSent'))
  } catch (error) {
    showError((error as { data?: { message?: string } }).data?.message || t('billing.postRequestFailed'))
  } finally { sendingPostRequest.value = false }
}
async function sendVideoRequest() {
  if (sendingVideoRequest.value || videosRequested.value < 1) return
  sendingVideoRequest.value = true
  videoRequestOpen.value = false
  try {
    await $fetch('/api/billing/package-request', { method: 'POST', body: { postsRequested: 0, creditsRequested: 0, videosRequested: videosRequested.value } })
    showSuccess(t('billing.videoRequestSent'))
  } catch (error) {
    showError((error as { data?: { message?: string } }).data?.message || t('billing.videoRequestFailed'))
  } finally { sendingVideoRequest.value = false }
}
async function sendCreditRequest() {
  if (sendingCreditRequest.value || creditsRequested.value < 1) return
  sendingCreditRequest.value = true
  creditRequestOpen.value = false
  try {
    await $fetch('/api/billing/package-request', {
      method: 'POST',
      body: {
        postsRequested: 0,
        creditsRequested: creditsRequested.value,
        ...(creditMessage.value.trim() ? { message: creditMessage.value.trim() } : {}),
      },
    })
    creditMessage.value = ''
    showSuccess(t('billing.creditRequestSent'))
  } catch (error) {
    showError(
      (error as { data?: { message?: string } }).data?.message || t('billing.creditRequestFailed'),
    )
  } finally {
    sendingCreditRequest.value = false
  }
}

let packageRefreshTimer: ReturnType<typeof setInterval> | undefined
let proposalSnapshotReady = false
let previousProposalId: string | null = null
watch(billing, (value) => {
  if (!proposalSnapshotReady && value) {
    const proposal = value.packageProposal
    previousProposalId = proposal ? `${proposal.name}:${proposal.startsAt}:${proposal.endsAt}` : null
    proposalSnapshotReady = true
  }
}, { immediate: true })
async function refreshLiveProposal() {
  if (document.visibilityState !== 'visible' || !pageActive.value) return
  await Promise.all([refreshBilling(), refreshCreditBalance(), refreshUsage()])
  const proposal = billing.value?.packageProposal
  const proposalId = proposal ? `${proposal.name}:${proposal.startsAt}:${proposal.endsAt}` : null
  if (proposalSnapshotReady && proposalId && proposalId !== previousProposalId)
    showSuccess(t('billing.packageProposalNotification'))
  previousProposalId = proposalId
}
let paymentRefreshTimer: ReturnType<typeof setInterval> | undefined
async function refreshAfterPayment() {
  if (paymentRefreshTimer) clearInterval(paymentRefreshTimer)
  await refreshLiveProposal()
  let attempts = 0
  paymentRefreshTimer = setInterval(() => {
    attempts += 1
    void refreshLiveProposal()
    // Keep polling until the webhook removes the paid proposal. The offer is
    // already hidden optimistically, so this does not block the customer.
    if (!serverPackageProposal.value || attempts >= 20) {
      if (paymentRefreshTimer) clearInterval(paymentRefreshTimer)
      paymentRefreshTimer = undefined
    }
  }, 500)
}
// The page is kept alive after leaving it, so its polling starts when it is
// shown and stops when it is left; otherwise it kept asking the server from
// other pages, and for a business that no longer exists, every few seconds.
function startPolling() {
  if (packageRefreshTimer) return
  packageRefreshTimer = setInterval(() => { void refreshLiveProposal() }, 5000)
  window.addEventListener('focus', refreshLiveProposal)
}
function stopPolling() {
  if (packageRefreshTimer) clearInterval(packageRefreshTimer)
  packageRefreshTimer = undefined
  if (paymentRefreshTimer) clearInterval(paymentRefreshTimer)
  paymentRefreshTimer = undefined
  window.removeEventListener('focus', refreshLiveProposal)
}
onMounted(startPolling)
onActivated(startPolling)
onDeactivated(stopPolling)
onBeforeUnmount(stopPolling)

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
function usageLimit(item: { key: string; limit: number }) {
  // The billing snapshot and the usage snapshot can finish at slightly
  // different times. Prefer the freshly refreshed active package for its
  // package quotas so the UI cannot show the new package card beside an old
  // progress-bar limit.
  if (item.key === 'posts_per_month' && customPackage.value?.postsIncluded != null)
    return customPackage.value.postsIncluded
  if (item.key === 'videos_per_month' && customPackage.value?.videosIncluded != null)
    return customPackage.value.videosIncluded
  return item.limit
}
function usagePercentage(item: { key: string; current: number; limit: number }) {
  const limit = usageLimit(item)
  if (limit <= 0) return 0
  return Math.min(100, Math.round((item.current / limit) * 100))
}
function usageState(item: { key: string; current: number; limit: number }) {
  const limit = usageLimit(item)
  if (limit > 0 && item.current >= limit) return 'exhausted'
  if (limit > 0 && item.current / limit >= 0.8) return 'warning'
  return 'normal'
}
const usageLabels: Record<string, string> = {
  posts_per_month: 'billing.usagePosts', videos_per_month: 'billing.usageVideos', ai_requests_per_day: 'billing.usageAi',
  media_storage_bytes: 'billing.usageStorage', social_accounts: 'billing.usageSocial', members: 'billing.usageMembers',
}
async function payForProposal() {
  if (!packageProposal.value || payingProposal.value) return
  // Close the app's offer dialog before opening Paddle. Keeping two modal
  // focus traps mounted makes the Paddle iframe lose focus until the user
  // clicks outside it.
  const offerClosed = waitForOfferClose()
  offerOpen.value = false
  payingProposal.value = true
  try {
      const transactionId = preparedProposalId.value === packageProposal.value.id && preparedTransactionId.value
        ? preparedTransactionId.value
        : await prepareProposalPayment()
      await offerClosed
      if (!paddleReady.value || !window.Paddle) throw new Error('PADDLE_CHECKOUT_UNAVAILABLE')
      window.Paddle.Checkout.open({ transactionId, settings: { showAddDiscounts: true } })
  } catch (error) {
    const data = (error as { data?: { data?: { code?: string }; code?: string } }).data
    showError((data?.data?.code || data?.code) === 'PADDLE_NOT_CONFIGURED'
      ? t('billing.paymentNotConfigured')
      : t('billing.paymentFailed'))
  } finally {
    payingProposal.value = false
  }
}
async function prepareProposalPayment() {
  const proposal = packageProposal.value
  if (!proposal) throw new Error('PACKAGE_PROPOSAL_UNAVAILABLE')
  if (preparedProposalId.value === proposal.id && preparedTransactionId.value)
    return preparedTransactionId.value
  if (prepareProposalPromise) return prepareProposalPromise
  prepareProposalPromise = $fetch<{ transactionId: string }>('/api/billing/package-payment', {
    method: 'POST',
    body: { packageId: proposal.id },
  }).then((result) => {
    preparedProposalId.value = proposal.id
    preparedTransactionId.value = result.transactionId
    return result.transactionId
  }).finally(() => {
    prepareProposalPromise = null
  })
  return prepareProposalPromise
}
async function declineProposal() {
  decliningProposal.value = true
  try {
    await $fetch('/api/billing/custom-package-decline', { method: 'POST', body: {} })
    await refreshBilling()
    offerOpen.value = false
    showSuccess(t('billing.packageProposalDeclined'))
  } catch (error) {
    showError((error as { data?: { message?: string } }).data?.message || t('billing.packageProposalFailed'))
  } finally { decliningProposal.value = false }
}
</script>

<template>
  <DashboardPage
    :title="t('nav.billing')"
    :description="t('billing.description')"
    :toolbar-border="false"
  >
    <UCard
      v-if="packageProposal"
      :ui="{ body: 'p-0 sm:p-0' }"
      class="cursor-pointer overflow-hidden ring-primary/30 transition-shadow hover:shadow-lg"
      @click="offerOpen = true"
    >
      <div class="bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-4 sm:p-5">
        <div class="flex items-center gap-3">
          <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-inverted">
            <UIcon name="i-lucide-handshake" class="size-5" />
          </span>
          <div class="min-w-0">
            <p class="text-xs font-medium uppercase tracking-wide text-primary">{{ t('billing.packageProposalTitle') }}</p>
            <h2 class="truncate text-base font-semibold text-highlighted">{{ packageProposal.name }}</h2>
          </div>
        </div>
        <p class="mt-4 text-3xl font-semibold tabular-nums text-highlighted">{{ formatMoney(packageProposal.price) }}</p>
        <ul class="mt-4 flex flex-wrap gap-2">
          <li
            v-for="part in proposalParts"
            :key="part.icon"
            class="inline-flex items-center gap-1.5 rounded-full bg-default/70 px-2.5 py-1 text-xs text-toned ring-1 ring-default ring-inset"
          >
            <UIcon :name="part.icon" class="size-3.5 text-primary" />{{ part.label }}
          </li>
        </ul>
      </div>
      <div class="grid grid-cols-[auto_1fr] gap-2 border-t border-default p-3 sm:flex sm:justify-end sm:p-4">
        <UButton color="neutral" variant="ghost" size="lg" :loading="decliningProposal" :label="t('billing.packageProposalDecline')" @click.stop="declineProposal" />
        <UButton icon="i-lucide-credit-card" size="lg" block class="sm:w-auto" :loading="payingProposal" :label="t('billing.payNow')" @mouseenter="prepareProposalPayment" @focus="prepareProposalPayment" @click.stop="payForProposal" />
      </div>
    </UCard>

    <UModal v-model:open="offerOpen" :title="t('billing.packageProposalTitle')" @after:leave="onOfferAfterLeave">
      <template #body>
        <div v-if="packageProposal" class="space-y-5">
          <div class="rounded-xl bg-primary/5 p-4">
            <p class="text-lg font-semibold">{{ packageProposal.name }}</p>
            <p class="mt-1 text-2xl font-bold text-primary">{{ formatMoney(packageProposal.price) }}</p>
          </div>
          <div class="space-y-3 text-sm">
            <div v-if="packageProposal.postsIncluded > 0" class="flex justify-between gap-4 border-b border-default pb-2">
              <span>{{ countLabel('billing.proposalPost', 'billing.proposalPosts', packageProposal.postsIncluded) }}</span>
              <UIcon name="i-lucide-check" class="size-5 text-primary" />
            </div>
            <div v-if="(packageProposal.videosIncluded ?? 0) > 0" class="flex justify-between gap-4 border-b border-default pb-2">
              <span>{{ countLabel('billing.proposalVideo', 'billing.proposalVideos', packageProposal.videosIncluded) }}</span>
              <UIcon name="i-lucide-check" class="size-5 text-primary" />
            </div>
            <p class="text-muted">{{ proposalSummary }}</p>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="outline" :loading="decliningProposal" :label="t('billing.packageProposalDecline')" @click="declineProposal" />
          <UButton icon="i-lucide-credit-card" :loading="payingProposal" :label="t('billing.payNow')" @click="payForProposal" />
        </div>
      </template>
    </UModal>

    <!-- What the business has comes first: its package, its credits and how
         much of the package is used. What it can add follows. -->
    <UCard as="section" :ui="{ body: 'p-4 sm:p-6 space-y-5' }">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div class="flex min-w-0 gap-3">
          <div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <UIcon name="i-lucide-package" class="size-5" />
          </div>
          <div class="min-w-0 space-y-1">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-base font-semibold">{{ customPackage ? customPackage.name : t('billing.noPackage') }}</h2>
              <UBadge v-if="customPackage" :color="customPackage.remainingDays <= 7 ? 'warning' : 'success'" variant="subtle" size="sm">
                {{ t('billing.customPackageDaysRemaining', { count: customPackage.remainingDays }) }}
              </UBadge>
            </div>
            <p v-if="customPackage" class="text-sm text-muted" data-testid="custom-package-end">
              {{ t('billing.customPackagePeriod', { start: formatPeriodDate(customPackage.startsAt), end: formatPeriodDate(customPackage.endsAt) }) }}
            </p>
            <p v-else class="text-sm text-muted">{{ t('request.appBody') }}</p>
            <span v-if="customPackage" class="sr-only" data-testid="custom-package-days-remaining">{{ t('billing.customPackageDaysRemaining', { count: customPackage.remainingDays }) }}</span>
          </div>
        </div>
        <div class="flex items-center gap-4 sm:flex-col sm:items-end sm:gap-2">
          <div v-if="creditBalance !== undefined" class="text-start sm:text-end">
            <p class="text-2xl font-semibold tabular-nums leading-none">{{ creditBalance }}</p>
            <p class="mt-1 text-xs text-muted">{{ t('billing.credits') }}</p>
          </div>
          <UModal
            v-model:open="requestOpen"
            :dismissible="false"
            :close="true"
            :title="customPackage ? t('request.appRenewTitle') : t('request.appTitle')"
          >
            <!-- A running package grows through the add-on cards below rather
                 than being replaced, so the button shows only without one. -->
            <UButton
              v-if="!customPackage"
              trailing-icon="i-lucide-arrow-right"
              :label="customPackage ? t('request.appRenewCta') : t('request.appCta')"
              class="ml-auto justify-center whitespace-nowrap sm:ml-0"
            />
            <template #body>
              <PackageRequestForm
                endpoint="/api/billing/package-request"
                compact
                contact-known
                :currency="(billing?.currency === 'EUR' ? 'EUR' : 'CHF')"
                :exchange-rate="billing?.exchangeRate || 1"
                @sent="requestOpen = false"
              />
            </template>
          </UModal>
        </div>
      </div>
      <!-- Each allowance as a tile: what is used of what is included, and a
           bar that turns amber when it runs low and red when it is used up. -->
      <div v-if="usage" class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div v-for="item in usage.usage" :key="item.key" class="space-y-2 rounded-lg border border-default p-3">
          <p class="truncate text-xs text-muted">{{ t(usageLabels[item.key] || item.key) }}</p>
          <p class="text-lg font-semibold tabular-nums leading-none">
            {{ usageValue(item.key, item.current) }}<span class="text-sm font-normal text-muted"> / {{ usageValue(item.key, usageLimit(item)) }}</span>
          </p>
          <UProgress :model-value="usagePercentage(item)" size="sm" :color="usageState(item) === 'exhausted' ? 'error' : usageState(item) === 'warning' ? 'warning' : 'primary'" />
        </div>
      </div>
    </UCard>

    <!-- What can be added to a running package, side by side where there is room. -->
    <div v-if="customPackage" class="grid gap-3 sm:grid-cols-2">
      <UCard as="section" :ui="{ body: 'p-4 sm:p-5 flex h-full flex-col gap-4' }">
        <div class="flex gap-3">
          <div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <UIcon name="i-lucide-image" class="size-5" />
          </div>
          <div class="min-w-0">
            <h2 class="text-sm font-semibold">{{ t('billing.posts') }}</h2>
            <p class="mt-0.5 text-sm text-muted">{{ t('billing.postsDescription') }}</p>
          </div>
        </div>
        <UButton
          variant="outline"
          icon="i-lucide-image"
          :label="t('billing.requestPosts')"
          class="mt-auto w-full justify-center"
          @click="postRequestOpen = true"
        />
      </UCard>
      <UCard as="section" :ui="{ body: 'p-4 sm:p-5 flex h-full flex-col gap-4' }">
        <div class="flex gap-3">
          <div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <UIcon name="i-lucide-clapperboard" class="size-5" />
          </div>
          <div class="min-w-0">
            <h2 class="text-sm font-semibold">{{ t('billing.videos') }}</h2>
            <p class="mt-0.5 text-sm text-muted">{{ t('billing.videosDescription') }}</p>
          </div>
        </div>
        <UButton
          variant="outline"
          icon="i-lucide-clapperboard"
          :label="t('billing.requestVideos')"
          class="mt-auto w-full justify-center"
          @click="videoRequestOpen = true"
        />
      </UCard>
      <UCard v-if="canBuyCredits" as="section" :ui="{ body: 'p-4 sm:p-5 flex h-full flex-col gap-4' }">
        <div class="flex gap-3">
          <div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <UIcon name="i-lucide-coins" class="size-5" />
          </div>
          <div class="min-w-0">
            <h2 class="text-sm font-semibold">{{ t('billing.credits') }}</h2>
            <p class="mt-0.5 text-sm text-muted">{{ t('billing.creditsDescription') }}</p>
          </div>
        </div>
        <UButton
          variant="outline"
          icon="i-lucide-coins"
          :label="t('billing.buyCredits')"
          class="mt-auto w-full justify-center"
          @click="creditRequestOpen = true"
        />
      </UCard>
    </div>

    <BillingAddOnModal
      v-model:open="postRequestOpen"
      v-model:amount="postsRequested"
      :title="t('billing.requestPostsTitle')"
      :description="t('billing.requestPostsDescription')"
      icon="i-lucide-image"
      :label="t('billing.posts')"
      :unit-price="postPrice"
      :submit-label="t('billing.requestPostsSubmit')"
      :format-money="formatMoney"
      :loading="sendingPostRequest"
      @submit="sendPostRequest"
    />
    <BillingAddOnModal
      v-model:open="videoRequestOpen"
      v-model:amount="videosRequested"
      :title="t('billing.requestVideosTitle')"
      :description="t('billing.requestVideosDescription')"
      icon="i-lucide-clapperboard"
      :label="t('billing.videoQuantity')"
      :unit-price="videoPrice"
      :submit-label="t('billing.requestVideosSubmit')"
      :format-money="formatMoney"
      :loading="sendingVideoRequest"
      @submit="sendVideoRequest"
    />
    <BillingAddOnModal
      v-model:open="creditRequestOpen"
      v-model:amount="creditsRequested"
      v-model:message="creditMessage"
      :title="t('billing.buyCreditsTitle')"
      :description="t('billing.buyCreditsDescription')"
      icon="i-lucide-coins"
      :label="t('billing.buyCreditsAmount')"
      :unit-price="creditPrice"
      :max="1000000"
      :submit-label="t('billing.buyCreditsSubmit')"
      :format-money="formatMoney"
      :loading="sendingCreditRequest"
      with-message
      :note="t('billing.buyCreditsNote')"
      @submit="sendCreditRequest"
    />
  </DashboardPage>
</template>
