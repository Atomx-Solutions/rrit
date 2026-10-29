<script setup lang="ts">
import { belowPaddleMinimum, paddleMinimumCents } from '~~/shared/utils/paddle-minimum'
import type { AdminPackageRequest } from './AdminPackageRequestDetails.vue'

/**
 * Answering a request for posts.
 *
 * A post package is sold by the post, so the only amounts here are the post
 * count, the per-post rate and the total they agree on. Videos and credits have
 * their own proposals and are deliberately absent: this form never sends
 * either, so a post package cannot quietly carry something the customer did not
 * ask for. The request says what was asked; this is where the team writes what
 * was actually sold.
 */
const props = defineProps<{ request: AdminPackageRequest | null }>()
const emit = defineEmits<{ close: []; done: [] }>()
const { t } = useI18n()
const toast = useToast()
const { onFormError, watchError } = useFormFeedback()
const { data: platformSettings } = await useFetch<{
  package_currency: 'CHF' | 'EUR'
  custom_package_post_price_cents: number
  custom_package_video_price_cents: number
}>('/api/admin/settings', {
  lazy: true,
  key: 'admin-package-request-settings',
})
const currency = computed(() => platformSettings.value?.package_currency || 'CHF')

type OrganizationRow = { id: string; name: string }
const search = ref('')
const invitation = reactive({ name: '', email: '' })
const invitationUrl = ref('')
const creatingOrganization = ref(false)
// A landing lead has no account yet, so the picker is only loaded when the
// request did not arrive from inside the app.
const { data: organizations, refresh: refreshOrganizations } = await useFetch<{
  items: OrganizationRow[]
}>('/api/admin/organizations', {
  query: computed(() => ({ q: search.value, per_page: 20 })),
  immediate: false,
  default: () => ({ items: [] }),
})
const organizationOptions = computed(() =>
  (organizations.value?.items || []).map(row => ({ label: row.name, value: row.id })),
)
function slugFor(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70)
}
async function inviteClientAndCreateOrganization() {
  if (!props.request) return
  const name = invitation.name.trim()
  const email = invitation.email.trim()
  const slug = slugFor(name)
  if (name.length < 2 || slug.length < 2 || !/^\S+@\S+\.\S+$/.test(email)) {
    error.value = t('admin.requests.organizationInvalid')
    return
  }
  creatingOrganization.value = true
  error.value = ''
  try {
    // This is deliberately the same path used by "Invite client": it opens
    // the organization and gives the lead an owner invitation in one action.
    // Creating a bare organization here left a public lead without an account
    // invitation or a way to access the agreed package.
    const result = await $fetch<{ url: string; organization: OrganizationRow }>('/api/admin/invitations', {
      method: 'POST',
      body: {
        name,
        slug,
        email,
        role: 'owner',
        expires_days: 7,
        package_request_id: props.request.id,
        profile: {
          businessName: name,
          contactName: props.request.contact_name,
          phone: props.request.phone || undefined,
          industry: props.request.industry || undefined,
        },
      },
    })
    form.organizationId = result.organization.id
    invitationUrl.value = result.url
    await refreshOrganizations()
  } catch (problem) {
    error.value = t((problem as { data?: { message?: string } }).data?.message || 'admin.requests.organizationCreateFailed')
  } finally {
    creatingOrganization.value = false
  }
}

const form = reactive({
  organizationId: '',
  name: '',
  postsIncluded: 20,
  videosIncluded: 0,
  postPriceEuro: 1.5,
  videoPriceEuro: 0,
  priceEuro: 30,
  startsAt: '',
  endsAt: '',
  notes: '',
})
const postPriceCents = computed(() => Math.round(form.postPriceEuro * 100))
const videoPriceCents = computed(() => Math.round(form.videoPriceEuro * 100))
const suggestedCents = computed(() => form.postsIncluded * postPriceCents.value + form.videosIncluded * videoPriceCents.value)
// Paddle cannot charge less than its minimum, so such an offer could never be paid.
const priceBelowMinimum = computed(() => belowPaddleMinimum(Math.round(form.priceEuro * 100), currency.value))
const minimumPriceMessage = computed(() =>
  priceBelowMinimum.value
    ? t('admin.packages.paddleMinimum', { price: formatMoney(paddleMinimumCents(currency.value)! / 100, currency.value) })
    : undefined,
)
watch(platformSettings, (settings) => {
  if (!settings) return
  form.postPriceEuro = settings.custom_package_post_price_cents / 100
  form.videoPriceEuro = settings.custom_package_video_price_cents / 100
  form.priceEuro = suggestedCents.value / 100
}, { immediate: true })
// The rate cannot always divide the total evenly, so an agreed total of 45.61
// over 30 posts keeps that total and shows the nearest rate beside it.

function dayToIso(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toISOString()
}

watch(
  () => props.request?.id,
  async (id) => {
    if (!id || !props.request) return
    const request = props.request
    const today = new Date()
    const inAMonth = new Date(today)
    inAMonth.setMonth(inAMonth.getMonth() + 1)
    Object.assign(form, {
      organizationId: request.organization_id || '',
      name: request.organization_name || request.business_name || request.contact_name,
      postsIncluded: request.posts_requested,
      videosIncluded: request.videos_requested || 0,
      startsAt: today.toISOString().slice(0, 10),
      endsAt: inAMonth.toISOString().slice(0, 10),
      notes: request.message || '',
    })
    Object.assign(invitation, {
      name: request.business_name || request.contact_name,
      email: request.contact_email,
    })
    invitationUrl.value = ''
    if (!request.organization_id) await refreshOrganizations()
    // Start with the dynamic net package total. The admin can still override
    // the agreed price manually before sending the proposal.
    form.priceEuro = suggestedCents.value / 100
  },
  { immediate: true },
)

const saving = ref(false)
const error = ref('')
watchError(error)
const pricingReady = computed(() => {
  const settings = platformSettings.value
  return !!settings
    && settings.custom_package_post_price_cents > 0
    && settings.custom_package_video_price_cents > 0
})

async function submit() {
  if (!props.request) return
  if (!pricingReady.value || Math.round(form.priceEuro * 100) <= 0 || priceBelowMinimum.value) return
  if (!form.organizationId) {
    error.value = t('admin.requests.convertNeedsOrganization')
    return
  }
  saving.value = true
  error.value = ''
  try {
    await $fetch(`/api/admin/organizations/${form.organizationId}/packages`, {
      method: 'POST',
      body: {
        name: form.name.trim(),
        posts_included: form.postsIncluded,
        videos_included: form.videosIncluded,
        post_price_cents: postPriceCents.value,
        video_price_cents: videoPriceCents.value,
        // The admin can negotiate this total independently of the suggested
        // item rates. VAT is added later when the invoice is issued.
        price_cents: Math.round(form.priceEuro * 100),
        starts_at: dayToIso(form.startsAt),
        ends_at: dayToIso(form.endsAt),
        status: 'draft',
        package_request_id: props.request.id,
        notes: form.notes.trim() || null,
      },
    })
    // The package endpoint also marks the linked request as proposal_sent.
    toast.add({ title: t('admin.requests.convertSaved'), color: 'success' })
    emit('done')
  } catch (problem) {
    error.value
      = t((problem as { data?: { message?: string } }).data?.message || 'admin.requests.convertFailed')
  } finally {
    saving.value = false
  }
}

async function copyInvitationLink() {
  try {
    await navigator.clipboard.writeText(invitationUrl.value)
    toast.add({ title: 'Invitation link copied.', color: 'success' })
  } catch {
    error.value = 'The invitation link could not be copied.'
  }
}
</script>
<template>
  <UModal
    :open="!!request"
    :title="t('admin.requests.convertTitle')"
    :description="request?.organization_name || request?.business_name || request?.contact_name"
    :ui="{ content: 'sm:max-w-xl' }"
    @update:open="(value: boolean) => { if (!value) emit('close') }"
  >
    <template #body>
      <UForm :state="form" class="space-y-4" @submit="submit" @error="onFormError">
        <UFormField
          v-if="!request?.organization_id"
          name="organizationId"
          :label="t('admin.requests.organization')"
          :hint="t('admin.requests.organizationHint')"
          required
        >
          <USelectMenu
            v-model="form.organizationId"
            v-model:search-term="search"
            :items="organizationOptions"
            value-key="value"
            searchable
            class="w-full"
          />
          <div v-if="!form.organizationId" class="mt-3 space-y-2 rounded-lg border border-default bg-elevated/30 p-3">
            <p class="text-xs text-muted">
              Invite the lead to create their client account and business. The package request is linked automatically.
            </p>
            <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <UInput v-model="invitation.name" placeholder="Business name" maxlength="120" />
              <UInput v-model="invitation.email" type="email" placeholder="Client email" maxlength="320" />
              <UButton type="button" color="neutral" variant="outline" :loading="creatingOrganization" label="Invite client" @click="inviteClientAndCreateOrganization" />
            </div>
          </div>
          <div v-else-if="invitationUrl" class="mt-3 flex items-center gap-2 rounded-lg border border-default bg-elevated/30 p-2">
            <UInput :model-value="invitationUrl" readonly class="min-w-0 flex-1 font-mono text-xs" />
            <UButton type="button" icon="i-lucide-copy" color="neutral" variant="outline" aria-label="Copy invitation link" @click="copyInvitationLink" />
          </div>
        </UFormField>
        <UFormField name="name" :label="t('admin.packages.name')" required>
          <UInput v-model="form.name" :maxlength="120" class="w-full" />
        </UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField
            name="postsIncluded"
            :label="t('admin.packages.posts')"
            :hint="t('admin.requests.askedFor', { count: request?.posts_requested ?? 0 })"
            required
          >
            <LiveInputNumber v-model="form.postsIncluded" :min="0" :max="1000" class="w-full" />
          </UFormField>
          <UFormField name="postPriceEuro" :label="`${t('admin.packages.postPrice')} (${currency})`" required>
            <LiveInputNumber
              v-model="form.postPriceEuro"
              :min="0.01"
              :max="10000"
              :step="0.01"
              :format-options="{ style: 'currency', currency }"
              class="w-full"
            />
          </UFormField>
        </div>
        <div v-if="form.videosIncluded > 0" class="grid gap-4 sm:grid-cols-2">
          <UFormField name="videosIncluded" label="Videos" :hint="`Asked for ${request?.videos_requested ?? 0}`" required>
            <LiveInputNumber v-model="form.videosIncluded" :min="0" :max="1000" class="w-full" />
          </UFormField>
          <UFormField name="videoPriceEuro" :label="`Video price (${currency})`" required>
            <LiveInputNumber v-model="form.videoPriceEuro" :min="0.01" :max="10000" :step="0.01" :format-options="{ style: 'currency', currency }" class="w-full" />
          </UFormField>
        </div>
        <UFormField
          name="priceEuro"
          :error="minimumPriceMessage"
          label="Offer price"
          :hint="`Calculated from the configured post and video prices. VAT is added on the invoice.`"
          required
        >
          <LiveInputNumber
            :model-value="suggestedCents / 100"
            :format-options="{ style: 'currency', currency }"
            disabled
            class="w-full"
          />
        </UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField name="startsAt" :label="t('admin.packages.startsAt')" required>
            <UInput v-model="form.startsAt" type="date" class="w-full" />
          </UFormField>
          <UFormField name="endsAt" :label="t('admin.packages.endsAt')" required>
            <UInput v-model="form.endsAt" type="date" class="w-full" />
          </UFormField>
        </div>
        <UFormField name="notes" :label="t('admin.packages.notes')">
          <UTextarea v-model="form.notes" :rows="2" :maxlength="2000" class="w-full" />
        </UFormField>
        <UButton type="submit" :loading="saving || !pricingReady" :disabled="!pricingReady || Math.round(form.priceEuro * 100) <= 0 || priceBelowMinimum" :label="t('admin.requests.sendProposal')" block />
      </UForm>
    </template>
  </UModal>
</template>
