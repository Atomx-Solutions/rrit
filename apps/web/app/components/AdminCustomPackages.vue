<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { z } from 'zod'
import { formatMoney } from '~~/shared/utils/format'

export type AdminCustomPackage = {
  id: string
  name: string
  posts_included: number
  credits_included: number
  post_price_cents: number
  price_cents: number
  suggested_price_cents: number
  currency: string
  starts_at: string
  ends_at: string
  status: 'draft' | 'active' | 'expired' | 'cancelled'
  notes: string | null
  used_posts: number
  remaining_posts: number
  remaining_days: number
}

const props = defineProps<{ organizationId: string; organizationName: string }>()
const { t } = useI18n()
const toast = useToast()
const { onFormError, watchError } = useFormFeedback()

const {
  data,
  status,
  execute: reload,
} = useFetch<{
  post_price_cents: number
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
const packages = computed(() => data.value?.packages || [])
// The platform rate is only the default a new package starts from; each
// package then carries the rate actually agreed with this organization.
const defaultPostPriceCents = computed(() => data.value?.post_price_cents ?? 0)
// Credits are priced from the same platform setting the credits screen edits,
// so a proposal can never quote a rate the platform does not charge.
const creditPriceCents = computed(() => data.value?.credit_price_cents ?? 0)

const statusColors: Record<AdminCustomPackage['status'], 'success' | 'info' | 'neutral'> = {
  active: 'success',
  draft: 'info',
  expired: 'neutral',
  cancelled: 'neutral',
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
  credits_included: z.number().int().min(0).max(10_000_000),
    post_price_cents: z.number().int().min(1, t('admin.packages.postPriceRequired')),
    price_cents: z.number().int().min(0),
    starts_at: z.string().min(1, t('admin.packages.dateRequired')),
    ends_at: z.string().min(1, t('admin.packages.dateRequired')),
  })
  .refine((value) => !value.ends_at || !value.starts_at || value.ends_at > value.starts_at, {
    message: t('admin.packages.periodInvalid'),
    path: ['ends_at'],
  })

const form = reactive({
  name: '',
  posts_included: 20,
  credits_included: 0,
  post_price_cents: 0,
  price_cents: 0,
  starts_at: '',
  ends_at: '',
  status: 'draft' as AdminCustomPackage['status'],
  notes: '',
})
const suggestedCents = computed(
  () => form.posts_included * form.post_price_cents + form.credits_included * creditPriceCents.value,
)
const overridden = computed(() => form.price_cents !== suggestedCents.value)
// The field is a currency input, so the admin works in euro while the package
// is stored, compared and audited in cents.
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

function startCreate() {
  const today = new Date()
  const inAMonth = new Date(today)
  inAMonth.setMonth(inAMonth.getMonth() + 1)
  error.value = ''
  editing.value = null
  Object.assign(form, {
    name: '',
    posts_included: 20,
    credits_included: 0,
    post_price_cents: defaultPostPriceCents.value,
    price_cents: 20 * defaultPostPriceCents.value,
    starts_at: today.toISOString().slice(0, 10),
    ends_at: inAMonth.toISOString().slice(0, 10),
    status: 'draft' as const,
    notes: '',
  })
  creating.value = true
}

function startEdit(row: AdminCustomPackage) {
  error.value = ''
  creating.value = false
  Object.assign(form, {
    name: row.name,
    posts_included: row.posts_included,
    credits_included: row.credits_included ?? 0,
    post_price_cents: row.post_price_cents,
    price_cents: row.price_cents,
    starts_at: dayInput(row.starts_at),
    ends_at: dayInput(row.ends_at),
    status: row.status,
    notes: row.notes || '',
  })
  editing.value = row
}

// Resizing follows the suggestion only while the price has not been negotiated
// away from it, so an agreed figure survives a change of size.
watch(
  () => [form.posts_included, form.post_price_cents, form.credits_included] as const,
  ([posts, rate, credits], [previousPosts, previousRate, previousCredits]) => {
    if (previousPosts === undefined) return
    if (posts === previousPosts && rate === previousRate && credits === previousCredits) return
    const previousSuggestion =
      previousPosts * previousRate + (previousCredits || 0) * creditPriceCents.value
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
    credits_included: form.credits_included,
    post_price_cents: form.post_price_cents,
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
  } catch (problem) {
    error.value = t(
      (problem as { data?: { message?: string } }).data?.message || 'admin.packages.saveFailed')
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
        <span v-if="row.original.credits_included > 0" class="text-muted"> · {{ t('admin.packages.creditsValue', { count: row.original.credits_included }) }}</span>
        <span class="ms-2 text-xs text-muted">
          {{
            t('admin.packages.perPost', { price: formatMoney(row.original.post_price_cents / 100) })
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
        <span>{{ formatMoney(row.original.price_cents / 100) }}</span>
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
      </template>
    </UTable>
  </UCard>
  <UModal
    :open="open"
    :title="editing ? t('admin.packages.editTitle') : t('admin.packages.createTitle')"
    :description="organizationName"
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
      <UForm :schema="schema" :state="form" class="space-y-4" @submit="submit" @error="onFormError">
        <UFormField name="name" :label="t('admin.packages.name')" required>
          <UInput v-model="form.name" :maxlength="120" class="w-full" />
        </UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField name="posts_included" :label="t('admin.packages.posts')" required>
            <UInputNumber v-model="form.posts_included" :min="0" :max="1000" class="w-full" />
          </UFormField>
          <UFormField
            name="credits_included"
            :label="t('admin.packages.credits')"
            :description="t('admin.packages.creditsHint')"
          >
            <UInputNumber v-model="form.credits_included" :min="0" :max="1000000" :step="100" class="w-full" />
          </UFormField>
          <UFormField
            name="post_price_cents"
            :label="t('admin.packages.postPrice')"
            required
          >
            <UInputNumber
              v-model="postPriceEuro"
              :min="0.01"
              :max="10000"
              :step="0.01"
              :format-options="{ style: 'currency', currency: 'EUR' }"
              class="w-full"
            />
          </UFormField>
        </div>
        <UFormField
          name="price_cents"
          :label="t('admin.packages.price')"
          :hint="t('admin.packages.suggested', { price: formatMoney(suggestedCents / 100) })"
          required
        >
          <UInputNumber
            v-model="priceEuro"
            :min="0"
            :step="0.01"
            :format-options="{ style: 'currency', currency: 'EUR' }"
            class="w-full"
          />
        </UFormField>
        <div v-if="overridden" class="flex items-center justify-between gap-2">
          <p class="text-xs text-muted">
            {{ t('admin.packages.overriddenHint') }}
          </p>
          <UButton
            color="neutral"
            variant="outline"
            size="xs"
            :label="t('admin.packages.useSuggestion')"
            @click="useSuggestion"
          />
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField name="starts_at" :label="t('admin.packages.startsAt')" required>
            <UInput v-model="form.starts_at" type="date" class="w-full" />
          </UFormField>
          <UFormField name="ends_at" :label="t('admin.packages.endsAt')" required>
            <UInput v-model="form.ends_at" type="date" class="w-full" />
          </UFormField>
        </div>
        <UFormField
          name="status"
          :label="t('admin.packages.statusLabel')"
          :hint="t('admin.packages.statusHint')"
          required
        >
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
        <UFormField
          name="notes"
          :label="t('admin.packages.notes')"
          :hint="t('admin.subscription.optional')"
        >
          <UTextarea v-model="form.notes" :maxlength="2000" :rows="2" class="w-full" />
        </UFormField>
        <UButton type="submit" :loading="saving" :label="t('admin.packages.save')" block />
      </UForm>
    </template>
  </UModal>
</template>
