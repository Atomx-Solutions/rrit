<script setup lang="ts">
import { formatMoney } from '~~/shared/utils/format'
import type { AdminPackageRequest } from './AdminPackageRequestDetails.vue'

/**
 * Turning an answered request into the package that was agreed. The request
 * says what the customer asked for; this is where the team writes what was
 * actually sold, so the amounts here are the agreement rather than the ask.
 */
const props = defineProps<{ request: AdminPackageRequest | null }>()
const emit = defineEmits<{ close: []; done: [] }>()
const { t } = useI18n()
const toast = useToast()
const { onFormError, watchError } = useFormFeedback()

type OrganizationRow = { id: string; name: string }
type ActivePackage = {
  id: string
  name: string
  posts_included: number
  post_price_cents: number
  price_cents: number
  ends_at: string
  status: 'active' | 'draft' | 'expired' | 'cancelled'
}
const search = ref('')
const newOrganizationName = ref('')
const creatingOrganization = ref(false)
const activePackage = ref<ActivePackage | null>(null)
const isAddingToActivePackage = computed(() => !!activePackage.value)
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
async function createOrganization() {
  const name = newOrganizationName.value.trim()
  const slug = slugFor(name)
  if (name.length < 2 || slug.length < 2) {
    error.value = t('admin.requests.organizationInvalid')
    return
  }
  creatingOrganization.value = true
  error.value = ''
  try {
    const organization = await $fetch<OrganizationRow>('/api/v1/organizations', {
      method: 'POST', body: { name, slug },
    })
    form.organizationId = organization.id
    newOrganizationName.value = ''
    await refreshOrganizations()
  } catch (problem) {
    error.value = (problem as { data?: { message?: string } }).data?.message || t('admin.requests.organizationCreateFailed')
  } finally {
    creatingOrganization.value = false
  }
}

const form = reactive({
  organizationId: '',
  name: '',
  postsIncluded: 20,
  postPriceEuro: 1.5,
  priceEuro: 30,
  startsAt: '',
  endsAt: '',
  notes: '',
})
const postPriceCents = computed(() => Math.round(form.postPriceEuro * 100))
const suggestedCents = computed(() => form.postsIncluded * postPriceCents.value)
const priceCents = computed(() => Math.round(form.priceEuro * 100))
const addedPriceCents = computed(() => form.postsIncluded * postPriceCents.value)
// The rate cannot always divide the total evenly, so an agreed total of 45.61
// over 30 posts keeps that total and shows the nearest rate beside it.
const overridden = computed(() => priceCents.value !== suggestedCents.value)

function dayToIso(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toISOString()
}

// The three amounts are one equation: posts times the rate is the total. Editing
// any of them moves the other that follows from it, so the figures on screen
// always describe the same agreement. The guard stops one edit from bouncing
// back through the field that caused it.
let syncing = false
function sync(update: () => void) {
  if (syncing) return
  syncing = true
  update()
  syncing = false
}
watch(
  [() => form.postsIncluded, () => form.postPriceEuro],
  () => sync(() => {
    form.priceEuro = Math.round(form.postsIncluded * form.postPriceEuro * 100) / 100
  }),
  { flush: 'sync' },
)
watch(
  () => form.priceEuro,
  () => sync(() => {
    if (form.postsIncluded > 0)
      form.postPriceEuro = Math.round(priceCents.value / form.postsIncluded) / 100
  }),
  { flush: 'sync' },
)

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
      startsAt: today.toISOString().slice(0, 10),
      endsAt: inAMonth.toISOString().slice(0, 10),
      notes: request.message || '',
    })
    if (!request.organization_id) await refreshOrganizations()
    await loadRate()
  },
  { immediate: true },
)

// The platform rate is only the starting point; it is per organization from here.
async function loadRate() {
  activePackage.value = null
  if (!form.organizationId) return
  try {
    const settings = await $fetch<{ post_price_cents: number; packages: ActivePackage[] }>(
      `/api/admin/organizations/${form.organizationId}/packages`,
    )
    const parent = settings.packages.find(item => item.status === 'active') || null
    activePackage.value = parent
    form.postPriceEuro = (parent?.post_price_cents ?? settings.post_price_cents) / 100
    if (parent) form.endsAt = new Date(parent.ends_at).toISOString().slice(0, 10)
  } catch {
    // The default in the form stands when the rate cannot be read.
  }
}
watch(() => form.organizationId, loadRate)

const saving = ref(false)
const error = ref('')
watchError(error)

async function submit() {
  if (!props.request) return
  if (!form.organizationId) {
    error.value = t('admin.requests.convertNeedsOrganization')
    return
  }
  saving.value = true
  error.value = ''
  try {
    if (activePackage.value) {
      await $fetch(`/api/admin/organizations/${form.organizationId}/packages/add-posts`, {
        method: 'POST',
        body: { posts_to_add: form.postsIncluded },
      })
      await $fetch(`/api/admin/package-requests/${props.request.id}`, {
        method: 'PATCH',
        body: { status: 'won', organizationId: form.organizationId },
      })
      toast.add({ title: t('admin.requests.addPostsSaved'), color: 'success' })
    } else {
      await $fetch(`/api/admin/organizations/${form.organizationId}/packages`, {
        method: 'POST',
        body: {
          name: form.name.trim(),
          posts_included: form.postsIncluded,
          post_price_cents: postPriceCents.value,
          price_cents: priceCents.value,
          starts_at: dayToIso(form.startsAt),
          ends_at: dayToIso(form.endsAt),
          status: 'draft',
          package_request_id: props.request.id,
          notes: form.notes.trim() || null,
        },
      })
      // The client accepts the draft from Billing; this only sends the proposal.
      await $fetch(`/api/admin/package-requests/${props.request.id}`, {
        method: 'PATCH',
        body: { status: 'proposal_sent', organizationId: form.organizationId },
      })
      toast.add({ title: t('admin.requests.convertSaved'), color: 'success' })
    }
    emit('done')
  } catch (problem) {
    error.value
      = (problem as { data?: { message?: string } }).data?.message
        || t('admin.requests.convertFailed')
  } finally {
    saving.value = false
  }
}
</script>
<template>
  <UModal
    :open="!!request"
    :title="isAddingToActivePackage ? t('admin.requests.addPostsTitle') : t('admin.requests.convertTitle')"
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
          <div class="mt-2 flex gap-2">
            <UInput v-model="newOrganizationName" :placeholder="t('admin.requests.newOrganizationPlaceholder')" class="flex-1" />
            <UButton color="neutral" variant="outline" :loading="creatingOrganization" :label="t('admin.requests.createOrganization')" @click="createOrganization" />
          </div>
        </UFormField>
        <div v-if="activePackage" class="rounded-md border border-default p-3 text-sm">
          <p class="font-medium">{{ activePackage.name }}</p>
          <p class="mt-1 text-muted">
            {{ t('admin.requests.parentPackageRate', { price: formatMoney(activePackage.post_price_cents / 100) }) }}
          </p>
          <p class="text-xs text-muted">
            {{ t('admin.requests.parentPackageEndsAt', { date: new Intl.DateTimeFormat('sq-XK').format(new Date(activePackage.ends_at)) }) }}
          </p>
        </div>
        <UFormField v-else name="name" :label="t('admin.packages.name')" required>
          <UInput v-model="form.name" :maxlength="120" class="w-full" />
        </UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField
            name="postsIncluded"
            :label="isAddingToActivePackage ? t('admin.requests.postsToAdd') : t('admin.packages.posts')"
            :hint="t('admin.requests.askedFor', { count: request?.posts_requested ?? 0 })"
            required
          >
            <UInputNumber v-model="form.postsIncluded" :min="1" :max="1000" class="w-full" />
          </UFormField>
          <UFormField v-if="!isAddingToActivePackage" name="postPriceEuro" :label="t('admin.packages.postPrice')" required>
            <UInputNumber
              v-model="form.postPriceEuro"
              :min="0.01"
              :max="10000"
              :step="0.01"
              :format-options="{ style: 'currency', currency: 'EUR' }"
              class="w-full"
            />
          </UFormField>
          <UFormField v-else :label="t('admin.packages.postPrice')">
            <UInput :model-value="formatMoney(form.postPriceEuro)" disabled class="w-full" />
          </UFormField>
        </div>
        <UFormField
          v-if="!isAddingToActivePackage"
          name="priceEuro"
          :label="t('admin.packages.price')"
          :hint="t('admin.packages.suggested', { price: formatMoney(suggestedCents / 100) })"
          required
        >
          <UInputNumber
            v-model="form.priceEuro"
            :min="0"
            :step="0.01"
            :format-options="{ style: 'currency', currency: 'EUR' }"
            class="w-full"
          />
        </UFormField>
        <div v-else class="rounded-md bg-elevated px-3 py-2 text-sm">
          <span class="text-muted">{{ t('admin.requests.addedPostsTotal') }}</span>
          <span class="ms-2 font-semibold">{{ formatMoney(addedPriceCents / 100) }}</span>
        </div>
        <p v-if="overridden" class="text-xs text-muted">
          {{ t('admin.packages.overriddenHint') }}
        </p>
        <div v-if="!isAddingToActivePackage" class="grid gap-4 sm:grid-cols-2">
          <UFormField name="startsAt" :label="t('admin.packages.startsAt')" required>
            <UInput v-model="form.startsAt" type="date" class="w-full" />
          </UFormField>
          <UFormField name="endsAt" :label="t('admin.packages.endsAt')" required>
            <UInput v-model="form.endsAt" type="date" class="w-full" />
          </UFormField>
        </div>
        <UFormField v-if="!isAddingToActivePackage" name="notes" :label="t('admin.packages.notes')">
          <UTextarea v-model="form.notes" :rows="2" :maxlength="2000" class="w-full" />
        </UFormField>
        <UButton type="submit" :loading="saving" :label="isAddingToActivePackage ? t('admin.requests.addPostsSubmit') : t('admin.requests.sendProposal')" block />
      </UForm>
    </template>
  </UModal>
</template>
