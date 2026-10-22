<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { z } from 'zod'

export type AdminCustomPackage = {
  id: string
  name: string
  posts_included: number
  videos_included: number
  credits_included: number
  post_price_cents: number
  video_price_cents: number
  price_cents: number
  suggested_price_cents: number
  currency: string
  starts_at: string
  ends_at: string
  status: 'draft' | 'active' | 'expired' | 'cancelled' | 'merged'
  notes: string | null
  used_posts: number
  remaining_posts: number
  remaining_days: number
}

const props = defineProps<{ organizationId: string; organizationName: string; editPackageId?: string | null }>()
const emit = defineEmits<{ editOpened: []; changed: [] }>()
const { t } = useI18n()
const toast = useToast()
const { onFormError, watchError } = useFormFeedback()

// Existing packages keep the currency they were agreed in.  The admin area,
// however, has one central currency, so render each historical package through
// the live rate API instead of merely replacing the € / CHF label.
const { data: platformSettings } = await useFetch<{ package_currency: 'CHF' | 'EUR' }>(
  '/api/admin/settings',
  { lazy: true, key: 'admin-custom-packages-currency' },
)
const displayCurrency = computed(() => platformSettings.value?.package_currency || 'CHF')
const { data: euroRate } = await useFetch<{ rate: number }>('/api/currency/rate', {
  lazy: true,
  key: 'admin-custom-packages-eur-rate',
  query: computed(() => ({ from: 'EUR', to: displayCurrency.value })),
})
const { data: chfRate } = await useFetch<{ rate: number }>('/api/currency/rate', {
  lazy: true,
  key: 'admin-custom-packages-chf-rate',
  query: computed(() => ({ from: 'CHF', to: displayCurrency.value })),
})

function packageRate(sourceCurrency: string) {
  if (sourceCurrency === displayCurrency.value) return 1
  return sourceCurrency === 'CHF' ? (chfRate.value?.rate || 1) : (euroRate.value?.rate || 1)
}
function formatPackageMoney(cents: number, sourceCurrency = 'EUR') {
  return new Intl.NumberFormat('sq-XK', {
    style: 'currency',
    currency: displayCurrency.value,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((cents / 100) * packageRate(sourceCurrency))
}
async function currentPackageRate(sourceCurrency: string) {
  if (sourceCurrency === displayCurrency.value) return 1
  try {
    const result = await $fetch<{ rate: number }>('/api/currency/rate', {
      query: { from: sourceCurrency, to: displayCurrency.value },
    })
    return result.rate
  } catch {
    // Keep the package editable if the rate provider is momentarily unavailable.
    return packageRate(sourceCurrency)
  }
}

const {
  data,
  status,
  execute: reload,
} = useFetch<{
  post_price_cents: number
  video_price_cents: number
  credit_price_cents: number
  packages: AdminCustomPackage[]
}>(() => `/api/admin/organizations/${props.organizationId}/packages`, {
  immediate: false,
  watch: false,
})
watch(
  () => props.organizationId,
  (id) => {
    if (id) void reload()
  },
  { immediate: true },
)
// Extra credits and videos bought on top of a package are merged into it; they
// are part of that package, not packages of their own, so the list leaves them out.
const packages = computed(() => (data.value?.packages || []).filter(pkg => pkg.status !== 'merged'))
// The platform rate is only the default a new package starts from; each
// package then carries the rate actually agreed with this organization.
const defaultPostPriceCents = computed(() => data.value?.post_price_cents ?? 0)
const defaultVideoPriceCents = computed(() => data.value?.video_price_cents ?? 0)
// Credits are priced from the same platform setting the credits screen edits,
// so a proposal can never quote a rate the platform does not charge.
const creditPriceCents = computed(() => data.value?.credit_price_cents ?? 0)

const statusColors: Record<AdminCustomPackage['status'], 'success' | 'info' | 'neutral'> = {
  active: 'success',
  draft: 'info',
  expired: 'neutral',
  cancelled: 'neutral',
  merged: 'neutral',
}
function formatDay(value: string) {
  return new Intl.DateTimeFormat('sq-XK', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Belgrade',
  }).format(new Date(value))
}
function dayInput(value: string) {
  return new Date(value).toISOString().slice(0, 10)
}
// A day chosen in the form is a whole day; the period runs from its start.
function dayToIso(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toISOString()
}

const editing = ref<AdminCustomPackage | null>(null)
const creating = ref(false)
const deleting = ref<AdminCustomPackage | null>(null)
const open = computed(() => creating.value || !!editing.value)
const saving = ref(false)
const error = ref('')
watchError(error)

const schema = z
  .object({
    name: z.string().trim().min(2, t('admin.packages.nameRequired')).max(120),
    // A credit top-up carries no posts; the refine below keeps an empty
  // proposal impossible.
  posts_included: z.number().int().min(0).max(1000),
  videos_included: z.number().int().min(0).max(1000),
  credits_included: z.number().int().min(0).max(10_000_000),
    post_price_cents: z.number().int().min(0).max(1_000_000),
    video_price_cents: z.number().int().min(0).max(1_000_000),
    price_cents: z.number().int().min(0),
    starts_at: z.string().min(1, t('admin.packages.dateRequired')),
    ends_at: z.string().min(1, t('admin.packages.dateRequired')),
  })
  .refine((value) => !value.ends_at || !value.starts_at || value.ends_at > value.starts_at, {
    message: t('admin.packages.periodInvalid'),
    path: ['ends_at'],
  })
  .refine(
    value => value.posts_included > 0 || value.videos_included > 0 || value.credits_included > 0,
    { message: 'A package must include posts, videos, or credits.', path: ['posts_included'] },
  )

const form = reactive({
  name: '',
  posts_included: 20,
  videos_included: 0,
  credits_included: 0,
  credit_top_up: 0,
  post_price_cents: 0,
  video_price_cents: 0,
  price_cents: 0,
  starts_at: '',
  ends_at: '',
  status: 'draft' as AdminCustomPackage['status'],
  notes: '',
})
const suggestedCents = computed(
  () => form.posts_included * form.post_price_cents
    + form.videos_included * form.video_price_cents
    + (form.credits_included + form.credit_top_up) * creditPriceCents.value,
)
// On an existing package this field means a new top-up, not the historical
// total. That makes entering 900 always add 900 credits to the wallet.
const creditsInput = computed({
  get: () => editing.value ? form.credit_top_up : form.credits_included,
  set: (value: number) => {
    if (editing.value) form.credit_top_up = value
    else form.credits_included = value
  },
})
const overridden = computed(() => form.price_cents !== suggestedCents.value)
// How the suggested price adds up, one line per kind of deliverable.
const priceLines = computed(() => [
  { label: `${form.posts_included} × ${t('admin.packages.posts')} · ${formatPackageMoney(form.post_price_cents, displayCurrency.value)}`, cents: form.posts_included * form.post_price_cents },
  { label: `${form.videos_included} × ${t('admin.packages.videos')} · ${formatPackageMoney(form.video_price_cents, displayCurrency.value)}`, cents: form.videos_included * form.video_price_cents },
  ...(form.credits_included > 0
    ? [{ label: `${form.credits_included} × ${t('admin.packages.credits')}`, cents: form.credits_included * creditPriceCents.value }]
    : []),
])
// Inputs work in the central admin currency; monetary values remain whole cents
// in storage and audit records.
const priceEuro = computed({
  get: () => form.price_cents / 100,
  set: (value: number) => {
    form.price_cents = Math.round((Number.isFinite(value) ? value : 0) * 100)
  },
})
const postPriceEuro = computed({
  get: () => form.post_price_cents / 100,
  set: (value: number) => {
    form.post_price_cents = Math.round((Number.isFinite(value) ? value : 0) * 100)
  },
})
const videoPriceEuro = computed({
  get: () => form.video_price_cents / 100,
  set: (value: number) => {
    form.video_price_cents = Math.round((Number.isFinite(value) ? value : 0) * 100)
  },
})

function startCreate() {
  const today = new Date()
  const inAMonth = new Date(today)
  inAMonth.setMonth(inAMonth.getMonth() + 1)
  error.value = ''
  editing.value = null
  Object.assign(form, {
    name: '',
    posts_included: 20,
    videos_included: 0,
    credits_included: 0,
    credit_top_up: 0,
    post_price_cents: defaultPostPriceCents.value,
    video_price_cents: defaultVideoPriceCents.value,
    price_cents: 20 * defaultPostPriceCents.value,
    starts_at: today.toISOString().slice(0, 10),
    ends_at: inAMonth.toISOString().slice(0, 10),
    status: 'draft' as const,
    notes: '',
  })
  creating.value = true
}

async function startEdit(row: AdminCustomPackage) {
  error.value = ''
  creating.value = false
  const rate = await currentPackageRate(row.currency || 'EUR')
  const converted = (cents: number) => Math.round(cents * rate)
  Object.assign(form, {
    name: row.name,
    posts_included: row.posts_included,
    videos_included: row.videos_included ?? 0,
    credits_included: row.credits_included ?? 0,
    credit_top_up: 0,
    post_price_cents: converted(row.post_price_cents),
    video_price_cents: converted(row.video_price_cents ?? 0),
    price_cents: converted(row.price_cents),
    starts_at: dayInput(row.starts_at),
    ends_at: dayInput(row.ends_at),
    status: row.status,
    notes: row.notes || '',
  })
  editing.value = row
}
// Asked from "Edit package": open that package's dialog once the list has it.
watch([() => props.editPackageId, packages], ([id, rows]) => {
  if (!id) return
  const row = rows.find(item => item.id === id)
  if (!row) return
  void startEdit(row)
  emit('editOpened')
}, { immediate: true })

// Resizing follows the suggestion only while the price has not been negotiated
// away from it, so an agreed figure survives a change of size.
watch(
  () => [form.posts_included, form.post_price_cents, form.videos_included, form.video_price_cents, form.credits_included, form.credit_top_up] as const,
  ([posts, postRate, videos, videoRate, credits, topUp], [previousPosts, previousPostRate, previousVideos, previousVideoRate, previousCredits, previousTopUp]) => {
    if (previousPosts === undefined) return
    if (posts === previousPosts && postRate === previousPostRate && videos === previousVideos && videoRate === previousVideoRate && credits === previousCredits && topUp === previousTopUp) return
    const previousSuggestion =
      previousPosts * previousPostRate
      + (previousVideos || 0) * previousVideoRate
      + ((previousCredits || 0) + (previousTopUp || 0)) * creditPriceCents.value
    if (form.price_cents === previousSuggestion) form.price_cents = suggestedCents.value
  },
)

function useSuggestion() {
  form.price_cents = suggestedCents.value
}

async function submit() {
  saving.value = true
  error.value = ''
  const notes = form.notes.trim()
  const body = {
    name: form.name.trim(),
    posts_included: form.posts_included,
    videos_included: form.videos_included,
    ...(editing.value
      ? { credit_top_up: form.credit_top_up || undefined }
      : { credits_included: form.credits_included }),
    post_price_cents: form.post_price_cents,
    video_price_cents: form.video_price_cents,
    price_cents: form.price_cents,
    starts_at: dayToIso(form.starts_at),
    ends_at: dayToIso(form.ends_at),
    status: form.status,
    notes: notes || null,
  }
  try {
    if (editing.value)
      await $fetch(
        `/api/admin/organizations/${props.organizationId}/packages/${editing.value.id}`,
        { method: 'PATCH', body },
      )
    else
      await $fetch(`/api/admin/organizations/${props.organizationId}/packages`, {
        method: 'POST',
        body,
      })
    toast.add({ title: t('admin.packages.saved'), color: 'success' })
    creating.value = false
    editing.value = null
    await reload()
    // The organization modal owns the credit snapshot shown on its Credits
    // tab. Tell it about package changes so an added credit amount appears
    // immediately, without closing or reopening the modal.
    emit('changed')
  } catch (problem) {
    error.value = t(
      (problem as { data?: { message?: string } }).data?.message || 'admin.packages.saveFailed')
  } finally {
    saving.value = false
  }
}

async function confirmDelete() {
  if (!deleting.value) return
  saving.value = true
  try {
    await $fetch(`/api/admin/organizations/${props.organizationId}/packages/${deleting.value.id}`, {
      method: 'DELETE',
      body: {},
    })
    toast.add({ title: t('admin.packages.deleted'), color: 'success' })
    deleting.value = null
    await reload()
    emit('changed')
  } catch (problem) {
    error.value = t((problem as { data?: { message?: string } }).data?.message || 'admin.packages.deleteFailed')
  } finally {
    saving.value = false
  }
}

const columns: TableColumn<AdminCustomPackage>[] = [
  { accessorKey: 'name', header: '' },
  { id: 'posts', header: '', meta: { class: { td: 'text-end whitespace-nowrap' } } },
  { id: 'price', header: '', meta: { class: { td: 'text-end whitespace-nowrap' } } },
  { id: 'period', header: '', meta: { class: { td: 'text-end whitespace-nowrap' } } },
  { id: 'status', header: '', meta: { class: { td: 'text-end' } } },
  { id: 'edit', header: '', meta: { class: { td: 'text-end' } } },
]
const listUi = {
  thead: 'hidden',
  td: 'px-4 py-2 text-sm border-b border-default',
  tbody: '[&>tr]:last:[&>td]:border-b-0',
  separator: 'h-0',
}
</script>
<template>
  <UCard :ui="{ header: 'p-4 sm:px-4', body: 'p-0 sm:p-0' }">
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <p class="text-sm font-semibold">
          {{ t('admin.packages.title') }}
        </p>
        <UButton
          icon="i-lucide-plus"
          color="neutral"
          variant="outline"
          size="xs"
          :label="t('admin.packages.create')"
          @click="startCreate"
        />
      </div>
    </template>
    <p v-if="status === 'pending'" class="px-4 py-3 text-sm text-muted">
      {{ t('admin.packages.loading') }}
    </p>
    <p v-else-if="!packages.length" class="px-4 py-3 text-sm text-muted">
      {{ t('admin.packages.empty') }}
    </p>
    <UTable v-else :data="packages" :columns="columns" :ui="listUi">
      <template #name-cell="{ row }">
        <span class="font-medium">{{ row.original.name }}</span>
      </template>
      <template #posts-cell="{ row }">
        <span>{{ t('admin.packages.postsValue', { count: row.original.posts_included }) }}</span>
        <span v-if="row.original.videos_included > 0" class="text-muted"> · {{ row.original.videos_included }} {{ t('admin.packages.videos') }}</span>
        <span v-if="row.original.credits_included > 0" class="text-muted"> · {{ t('admin.packages.creditsValue', { count: row.original.credits_included }) }}</span>
        <span class="ms-2 text-xs text-muted">
          {{
            t('admin.packages.perPost', { price: formatPackageMoney(row.original.post_price_cents, row.original.currency) })
          }}
        </span>
        <p class="text-xs text-muted">
          {{ t('admin.packages.usageValue', {
            used: row.original.used_posts,
            remaining: row.original.remaining_posts,
          }) }}
          <template v-if="row.original.status === 'active'">
            · {{ t('admin.packages.daysRemaining', { count: row.original.remaining_days }) }}
          </template>
        </p>
      </template>
      <template #price-cell="{ row }">
        <span>{{ formatPackageMoney(row.original.price_cents, row.original.currency) }}</span>
        <UBadge
          v-if="row.original.price_cents !== row.original.suggested_price_cents"
          color="warning"
          variant="subtle"
          size="sm"
          class="ms-2"
          :label="t('admin.packages.overridden')"
        />
      </template>
      <template #period-cell="{ row }">
        {{ formatDay(row.original.starts_at) }} – {{ formatDay(row.original.ends_at) }}
      </template>
      <template #status-cell="{ row }">
        <UBadge
          :color="statusColors[row.original.status]"
          variant="subtle"
          :label="t(`admin.packages.status.${row.original.status}`)"
        />
      </template>
      <template #edit-cell="{ row }">
        <UButton
          icon="i-lucide-pencil"
          color="neutral"
          variant="ghost"
          size="xs"
          :aria-label="t('admin.packages.editFor', { name: row.original.name })"
          @click="startEdit(row.original)"
        />
        <UButton
          icon="i-lucide-trash-2"
          color="error"
          variant="ghost"
          size="xs"
          :aria-label="t('admin.packages.deleteFor', { name: row.original.name })"
          @click="deleting = row.original"
        />
      </template>
    </UTable>
  </UCard>
  <UModal
    :open="open"
    :title="editing ? t('admin.packages.editTitle') : t('admin.packages.createTitle')"
    :description="organizationName"
    :ui="{ content: 'sm:max-w-3xl', body: 'space-y-6' }"
    @update:open="
      (value: boolean) => {
        if (!value) {
          creating = false
          editing = null
        }
      }
    "
  >
    <template #body>
      <UForm id="custom-package-form" :schema="schema" :state="form" class="space-y-6" @submit="submit" @error="onFormError">
        <!-- Who it is for and when it runs -->
        <section class="space-y-4">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-muted">{{ t('admin.packages.sectionDetails') }}</h3>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField name="name" :label="t('admin.packages.name')" required>
              <UInput v-model="form.name" :maxlength="120" class="w-full" />
            </UFormField>
            <UFormField name="status" :label="t('admin.packages.statusLabel')" :hint="t('admin.packages.statusHint')" required>
              <USelect
                v-model="form.status"
                :items="[
                  { label: t('admin.packages.status.draft'), value: 'draft' },
                  { label: t('admin.packages.status.active'), value: 'active' },
                  { label: t('admin.packages.status.expired'), value: 'expired' },
                  { label: t('admin.packages.status.cancelled'), value: 'cancelled' },
                ]"
                class="w-full"
              />
            </UFormField>
            <UFormField name="starts_at" :label="t('admin.packages.startsAt')" required>
              <UInput v-model="form.starts_at" type="date" class="w-full" />
            </UFormField>
            <UFormField name="ends_at" :label="t('admin.packages.endsAt')" required>
              <UInput v-model="form.ends_at" type="date" class="w-full" />
            </UFormField>
          </div>
        </section>

        <USeparator />

        <!-- What the client receives -->
        <section class="space-y-4">
          <div>
            <h3 class="text-xs font-semibold uppercase tracking-wide text-muted">{{ t('admin.packages.sectionContents') }}</h3>
            <p class="mt-1 text-xs text-muted">{{ t('admin.packages.creditsHint') }}</p>
          </div>
          <div class="grid gap-4 sm:grid-cols-3">
            <UFormField name="posts_included" :label="t('admin.packages.posts')" required>
              <LiveInputNumber v-model="form.posts_included" :min="0" :max="1000" class="w-full" />
            </UFormField>
            <UFormField name="videos_included" :label="t('admin.packages.videos')" required>
              <LiveInputNumber v-model="form.videos_included" :min="0" :max="1000" class="w-full" />
            </UFormField>
            <UFormField
              name="credits_included"
              :label="editing ? t('billing.creditTopUpQuantity') : t('admin.packages.credits')"
              :hint="editing ? t('billing.creditTopUpDescription') : undefined"
            >
              <LiveInputNumber v-model="creditsInput" :min="0" :max="1000000" :step="100" :step-snapping="false" class="w-full" />
            </UFormField>
          </div>
        </section>

        <USeparator />

        <!-- What it costs: the rates, how they add up, and the agreed figure -->
        <section class="space-y-4">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-muted">{{ t('admin.packages.sectionPricing') }}</h3>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField name="post_price_cents" :label="t('admin.packages.postPrice')" required>
              <LiveInputNumber
                v-model="postPriceEuro"
                :min="0.01"
                :max="10000"
                :step="0.01"
                :format-options="{ style: 'currency', currency: displayCurrency }"
                class="w-full"
              />
            </UFormField>
            <UFormField name="video_price_cents" :label="t('admin.packages.videoPrice')">
              <LiveInputNumber
                v-model="videoPriceEuro"
                :min="0"
                :max="10000"
                :step="0.01"
                :format-options="{ style: 'currency', currency: displayCurrency }"
                class="w-full"
              />
            </UFormField>
          </div>
          <div class="rounded-lg bg-elevated/60 ring ring-default p-4 space-y-2 text-sm">
            <div v-for="line in priceLines" :key="line.label" class="flex items-center justify-between gap-3">
              <span class="text-muted">{{ line.label }}</span>
              <span class="tabular-nums">{{ formatPackageMoney(line.cents, displayCurrency) }}</span>
            </div>
            <USeparator />
            <div class="flex items-center justify-between gap-3 font-medium">
              <span>{{ t('admin.packages.suggestedTotal') }}</span>
              <span class="tabular-nums">{{ formatPackageMoney(suggestedCents, displayCurrency) }}</span>
            </div>
          </div>
          <UFormField name="price_cents" :label="t('admin.packages.price')" required>
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
              <LiveInputNumber
                v-model="priceEuro"
                :min="0"
                :step="0.01"
                :format-options="{ style: 'currency', currency: displayCurrency }"
                class="w-full sm:flex-1"
              />
              <UButton
                v-if="overridden"
                color="neutral"
                variant="outline"
                :label="t('admin.packages.useSuggestion')"
                @click="useSuggestion"
              />
            </div>
            <template v-if="overridden" #help>
              {{ t('admin.packages.overriddenHint') }}
            </template>
          </UFormField>
        </section>

        <USeparator />

        <UFormField name="notes" :label="t('admin.packages.notes')" :hint="t('admin.subscription.optional')">
          <UTextarea v-model="form.notes" :maxlength="2000" :rows="2" class="w-full" />
        </UFormField>
      </UForm>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          color="neutral"
          variant="outline"
          :label="t('admin.packages.cancel')"
          @click="creating = false; editing = null"
        />
        <UButton type="submit" form="custom-package-form" :loading="saving" :label="t('admin.packages.save')" />
      </div>
    </template>
  </UModal>
  <UModal
    :open="!!deleting"
    :title="t('admin.packages.deleteTitle')"
    :description="organizationName"
    :ui="{ content: 'sm:max-w-xl' }"
    @update:open="(value: boolean) => { if (!value) deleting = null }"
  >
    <template #body>
      <p class="mb-4 text-sm text-muted">{{ t('admin.packages.deleteWarning') }}</p>
      <dl class="space-y-2 rounded-md border border-default bg-elevated/30 p-3 text-sm">
        <div class="flex gap-3"><dt class="w-32 shrink-0 text-muted">{{ t('admin.packages.name') }}</dt><dd class="font-medium">{{ deleting?.name }}</dd></div>
        <div class="flex gap-3"><dt class="w-32 shrink-0 text-muted">{{ t('admin.details.organization') }}</dt><dd class="font-medium">{{ organizationName }}</dd></div>
      </dl>
      <div class="mt-5 flex justify-end gap-2">
        <UButton color="neutral" variant="outline" :label="t('admin.packages.cancel')" @click="deleting = null" />
        <UButton color="error" :loading="saving" :label="t('admin.packages.delete')" @click="confirmDelete" />
      </div>
    </template>
  </UModal>
</template>
