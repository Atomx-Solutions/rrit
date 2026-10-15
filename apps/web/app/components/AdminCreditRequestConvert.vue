<script setup lang="ts">
import { formatMoney } from '~~/shared/utils/format'
import type { AdminPackageRequest } from './AdminPackageRequestDetails.vue'

/**
 * Answering a request for credits.
 *
 * A credit top-up is sold as a proposal that carries credits instead of posts
 * and joins the package the organization already runs, so the fields a package
 * needs — post count, per-post rate, a period of its own — have no meaning
 * here and are not asked for. The dates the row still requires are set to a
 * nominal day: accepting a credit-only proposal keeps the active package's own
 * period and never extends it.
 */
const props = defineProps<{ request: AdminPackageRequest | null }>()
const emit = defineEmits<{ close: []; done: [] }>()
const { t } = useI18n()
const toast = useToast()
const { onFormError, watchError } = useFormFeedback()
const { data: currencySettings } = await useFetch<{ package_currency: 'CHF' | 'EUR' }>('/api/admin/settings', {
  lazy: true,
  key: 'admin-package-request-currency',
})
// Offers are written in the central admin currency (Admin → Settings).
const currency = computed(() => currencySettings.value?.package_currency || 'CHF')

// The per-credit rate opens at the platform figure and is negotiable from
// there, exactly as the per-post rate is for a package. The platform rate
// itself is never written by this form.
const form = reactive({ credits: 0, creditPrice: 0, price: 0, notes: '' })
const creditPriceCents = computed(() => Math.round(form.creditPrice * 100))
const suggestedCents = computed(() => form.credits * creditPriceCents.value)
const priceCents = computed(() => Math.round(form.price * 100))
const overridden = computed(() => priceCents.value !== suggestedCents.value)
const organizationId = computed(() => props.request?.organization_id || '')

const saving = ref(false)
const error = ref('')
watchError(error)

// Credits are priced from the rate the superadmin sets on the credits screen,
// so a proposal can never quote a number the platform does not charge.
async function loadRate() {
  if (!organizationId.value) return
  try {
    const settings = await $fetch<{ credit_price_cents: number }>(
      `/api/admin/organizations/${organizationId.value}/packages`,
    )
    form.creditPrice = settings.credit_price_cents / 100
    // Seed the agreed price immediately after loading the platform rate.
    // Without this, the input keeps its zero default until another field changes.
    form.price = Math.round(form.credits * form.creditPrice * 100) / 100
  } catch {
    // Without the rate the admin still types the agreed price by hand.
  }
}

// Credits, the rate and the total are one equation, so editing any of them
// moves the one that follows from it. The guard stops an edit from bouncing
// back through the field that caused it. The rate is a source of its own
// because it arrives from the settings after the form has opened.
let syncing = false
function sync(update: () => void) {
  if (syncing) return
  syncing = true
  update()
  syncing = false
}
watch(
  [() => form.credits, () => form.creditPrice],
  () => sync(() => {
    form.price = Math.round(suggestedCents.value) / 100
  }),
  { flush: 'sync' },
)
watch(
  () => form.price,
  () => sync(() => {
    if (form.credits > 0) form.creditPrice = priceCents.value / form.credits / 100
  }),
  { flush: 'sync' },
)

watch(
  () => props.request,
  async (request) => {
    if (!request) return
    form.credits = request.credits_requested || 0
    form.notes = request.message || ''
    form.creditPrice = 0
    await loadRate()
  },
  { immediate: true },
)

function nominalPeriod() {
  const start = new Date()
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return {
    starts_at: new Date(`${start.toISOString().slice(0, 10)}T00:00:00.000Z`).toISOString(),
    ends_at: new Date(`${end.toISOString().slice(0, 10)}T00:00:00.000Z`).toISOString(),
  }
}

async function submit() {
  if (!props.request) return
  if (!organizationId.value) {
    error.value = t('admin.requests.convertNeedsOrganization')
    return
  }
  if (form.credits < 1) {
    error.value = t('admin.requests.creditsRequired')
    return
  }
  saving.value = true
  error.value = ''
  try {
    await $fetch(`/api/admin/organizations/${organizationId.value}/packages`, {
      method: 'POST',
      body: {
        name: t('admin.requests.creditProposalName', { count: form.credits }),
        posts_included: 0,
        credits_included: form.credits,
        price_cents: priceCents.value,
        ...nominalPeriod(),
        status: 'draft',
        package_request_id: props.request.id,
        notes: form.notes.trim() || null,
      },
    })
    // The client accepts the draft from Billing; this only sends the proposal.
    await $fetch(`/api/admin/package-requests/${props.request.id}`, {
      method: 'PATCH',
      body: { status: 'proposal_sent', organizationId: organizationId.value },
    })
    toast.add({ title: t('admin.requests.convertSaved'), color: 'success' })
    emit('done')
  } catch (problem) {
    error.value
      = t((problem as { data?: { message?: string } }).data?.message
        || 'admin.requests.convertFailed')
  } finally {
    saving.value = false
  }
}
</script>
<template>
  <UModal
    :open="!!request"
    :title="t('admin.requests.creditConvertTitle')"
    :description="request?.organization_name || request?.business_name || request?.contact_name"
    :ui="{ content: 'sm:max-w-lg' }"
    @update:open="(value: boolean) => { if (!value) emit('close') }"
  >
    <template #body>
      <UForm :state="form" class="space-y-4" @submit="submit" @error="onFormError">
        <UAlert
          v-if="!organizationId"
          color="warning"
          variant="outline"
          icon="i-lucide-circle-alert"
          :title="t('admin.requests.convertNeedsOrganization')"
        />
        <UFormField
          name="credits"
          :label="t('admin.packages.credits')"
          :hint="t('admin.requests.askedForCredits', { count: request?.credits_requested ?? 0 })"
          required
        >
          <LiveInputNumber v-model="form.credits" :min="0" :max="1000000" :step="100" :step-snapping="false" class="w-full" />
        </UFormField>
        <UFormField
          name="creditPrice"
          :label="t('admin.requests.creditPrice')"
          :description="t('admin.requests.creditRateHelp')"
          required
        >
          <LiveInputNumber
            v-model="form.creditPrice"
            :min="0"
            :step="0.01"
            :format-options="{ style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 4 }"
            class="w-full"
          />
        </UFormField>
        <UFormField
          name="price"
          :label="t('admin.packages.price')"
          :hint="t('admin.packages.suggested', { price: formatMoney(suggestedCents / 100, currency) })"
          required
        >
          <LiveInputNumber
            v-model="form.price"
            :min="0"
            :step="0.01"
            :format-options="{ style: 'currency', currency }"
            class="w-full"
          />
          <template v-if="overridden" #help>
            {{ t('admin.packages.overriddenHint') }}
          </template>
        </UFormField>
        <UFormField name="notes" :label="t('admin.packages.notes')">
          <UTextarea v-model="form.notes" :rows="3" :maxlength="2000" class="w-full" />
        </UFormField>
        <p class="text-xs text-muted">{{ t('admin.requests.creditJoinsPackage') }}</p>
        <UButton type="submit" block :loading="saving" :disabled="!organizationId">
          {{ t('admin.requests.convertSubmit') }}
        </UButton>
      </UForm>
    </template>
  </UModal>
</template>
