<script setup lang="ts">
export type PackageAddition = {
  id: string
  kind: 'paid' | 'gift'
  posts: number
  videos: number
  credits: number
  value_cents: number
  currency: string
  created_at: string
  actor_email: string | null
  number: string | null
  invoice_id: string | null
  gift_id: string | null
  credits_granted?: number
  reason: string | null
  payment_status: 'paid' | 'unpaid' | 'overdue' | 'gift'
}

export type PackageForState = {
  id: string
  name: string
  posts_included: number
  videos_included: number
  credits_included: number
  post_price_cents: number
  video_price_cents: number
  currency: string
  starts_at: string
  ends_at: string
  used_posts: number
  used_videos: number
  remaining_days: number
  credits_granted?: number
  additions?: PackageAddition[]
}

const props = defineProps<{
  organizationId: string
  organizationName: string
  pkg: PackageForState
  creditsRemaining: number
  creditPriceCents: number
  creditsPerPost: number
  creditsPerVideo: number
  formatMoney: (cents: number, currency?: string) => string
}>()
const emit = defineEmits<{ changed: [] }>()
const { t } = useI18n()
const toast = useToast()

type Kind = 'posts' | 'videos' | 'credits'
const kinds: Kind[] = ['posts', 'videos', 'credits']
const icons: Record<Kind, string> = { posts: 'i-lucide-image', videos: 'i-lucide-clapperboard', credits: 'i-lucide-coins' }

const additions = computed(() => props.pkg.additions ?? [])
// The latest few are enough at a glance; the rest open on demand.
const showAll = ref(false)
const shownAdditions = computed(() => showAll.value ? additions.value : additions.value.slice(0, 3))
function sum(kind: Kind, of: 'paid' | 'gift') {
  return additions.value.filter(item => item.kind === of).reduce((total, item) => total + item[kind], 0)
}
const included: Record<Kind, () => number> = {
  posts: () => props.pkg.posts_included,
  videos: () => props.pkg.videos_included,
  // The credits the package handed out: those its posts fund plus every addition.
  credits: () => Math.max(props.pkg.credits_granted ?? 0, props.pkg.credits_included),
}
// What was bought at first is the package without what was added since.
const rows = computed(() => kinds.map((kind) => {
  const total = included[kind]()
  const added = sum(kind, 'paid')
  const gifted = sum(kind, 'gift')
  const remaining = kind === 'posts'
    ? Math.max(0, total - props.pkg.used_posts)
    : kind === 'videos'
      ? Math.max(0, total - props.pkg.used_videos)
      : Math.min(total, Math.max(0, props.creditsRemaining))
  const used = kind === 'credits' ? Math.max(0, total - remaining) : kind === 'posts' ? props.pkg.used_posts : props.pkg.used_videos
  return {
    kind,
    total,
    bought: Math.max(0, total - added - gifted),
    added,
    gifted,
    used,
    remaining,
    percent: total ? Math.min(100, Math.round((remaining / total) * 100)) : 0,
  }
}))

function itemsLabel(item: Pick<PackageAddition, Kind>) {
  return kinds
    .filter(kind => item[kind] > 0)
    .map(kind => t(`admin.packageState.count.${kind}`, { count: item[kind] }))
    .join(' · ')
}

// --- Add or gift ---
const mode = ref<'paid' | 'gift' | null>(null)
const amounts = reactive<Record<Kind, number>>({ posts: 0, videos: 0, credits: 0 })
const reason = ref('')
const customPrice = ref<number | null>(null)
const saving = ref(false)
const error = ref('')

const rates = computed<Record<Kind, number>>(() => ({
  posts: props.pkg.post_price_cents,
  videos: props.pkg.video_price_cents,
  credits: props.creditPriceCents,
}))
const rateValueCents = computed(() => kinds.reduce((total, kind) => total + amounts[kind] * rates.value[kind], 0))
const valueCents = computed(() => mode.value === 'paid' && customPrice.value !== null
  ? Math.round(customPrice.value * 100)
  : rateValueCents.value)
// Like a purchase, each post and video brings its credits to the balance.
const creditsToBalance = computed(() =>
  amounts.posts * props.creditsPerPost + amounts.videos * props.creditsPerVideo + amounts.credits)
const nothingChosen = computed(() => kinds.every(kind => amounts[kind] === 0))
const canSave = computed(() => !nothingChosen.value
  && valueCents.value > 0
  && (mode.value !== 'gift' || reason.value.trim().length >= 3))
const steps: Record<Kind, number> = { posts: 1, videos: 1, credits: 100 }

function start(next: 'paid' | 'gift') {
  Object.assign(amounts, { posts: 0, videos: 0, credits: 0 })
  reason.value = ''
  customPrice.value = null
  error.value = ''
  mode.value = next
}

async function save() {
  if (!mode.value || !canSave.value) return
  saving.value = true
  error.value = ''
  try {
    const result = await $fetch<{ number: string | null }>(
      `/api/admin/organizations/${props.organizationId}/packages/${props.pkg.id}/additions`,
      {
        method: 'POST',
        body: {
          ...amounts,
          ...(mode.value === 'paid' && customPrice.value !== null ? { price_cents: valueCents.value } : {}),
          gift: mode.value === 'gift',
          ...(mode.value === 'gift' ? { reason: reason.value.trim() } : {}),
        },
      },
    )
    toast.add({
      title: t(mode.value === 'gift' ? 'admin.packageState.giftSaved' : 'admin.packageState.addSaved'),
      description: result.number ?? undefined,
      color: 'success',
      icon: mode.value === 'gift' ? 'i-lucide-gift' : 'i-lucide-receipt',
    })
    mode.value = null
    emit('changed')
  } catch (problem) {
    error.value = t((problem as { data?: { message?: string } }).data?.message || 'admin.packages.saveFailed')
  } finally {
    saving.value = false
  }
}

// Each addition opens the invoice or gift document it produced.
const preview = ref<PackageAddition | null>(null)
function documentUrl(item: PackageAddition, inline: boolean) {
  const path = item.gift_id ? `gifts/${item.gift_id}` : `invoices/${item.invoice_id}`
  return `/api/admin/organizations/${props.organizationId}/${path}/pdf${inline ? '?inline=1' : ''}`
}

const statusColor: Record<PackageAddition['payment_status'], 'success' | 'warning' | 'error' | 'primary'> = {
  paid: 'success',
  unpaid: 'warning',
  overdue: 'error',
  gift: 'primary',
}
function formatDay(value: string) {
  return new Intl.DateTimeFormat('sq-XK', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Zurich' })
    .format(new Date(value))
}
</script>

<template>
  <!-- Shown in the package's dialog, whose title names the package. -->
  <div class="space-y-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="min-w-0">
          <p class="text-sm text-muted">
            {{ formatDay(pkg.starts_at) }} – {{ formatDay(pkg.ends_at) }}
            · {{ t('admin.packages.daysRemaining', { count: pkg.remaining_days }) }}
          </p>
        </div>
        <div class="flex gap-2">
          <UButton icon="i-lucide-plus" :label="t('admin.packageState.add')" @click="start('paid')" />
          <UButton icon="i-lucide-gift" color="neutral" variant="outline" :label="t('admin.packageState.gift')" @click="start('gift')" />
        </div>
      </div>

    <!-- Where the package stands: what is left, and what came on top -->
    <div class="grid gap-3 sm:grid-cols-3">
      <div v-for="row in rows" :key="row.kind" class="rounded-lg bg-elevated/50 px-4 py-3">
        <div class="flex items-center justify-between text-xs text-muted">
          <span class="flex items-center gap-1.5">
            <UIcon :name="icons[row.kind]" class="size-3.5" />
            {{ t(`admin.packageState.${row.kind}`) }}
          </span>
        </div>
        <p class="mt-1 text-xl font-semibold tabular-nums">
          {{ row.remaining }}
          <span class="text-xs font-normal text-muted">
            {{ t('admin.packageState.ofTotal', { total: row.total }) }}
          </span>
        </p>
        <UProgress :model-value="row.percent" size="xs" class="mt-2" />
        <p v-if="row.added || row.gifted" class="mt-2 text-xs text-muted tabular-nums">
          <span v-if="row.added">{{ t('admin.packageState.addedShort', { count: row.added }) }}</span>
          <span v-if="row.added && row.gifted"> · </span>
          <span v-if="row.gifted" class="text-primary">{{ t('admin.packageState.giftedShort', { count: row.gifted }) }}</span>
        </p>
      </div>
    </div>

    <!-- The latest additions, with their documents -->
    <div v-if="additions.length">
      <div class="mb-1 flex items-center justify-between">
        <p class="text-xs font-medium text-muted">{{ t('admin.packageState.history') }}</p>
        <UButton
          v-if="additions.length > 3"
          color="neutral"
          variant="link"
          size="xs"
          :label="showAll ? t('admin.packageState.showLess') : t('admin.packageState.showAll', { count: additions.length })"
          @click="showAll = !showAll"
        />
      </div>
      <ul class="divide-y divide-default">
        <li
          v-for="item in shownAdditions"
          :key="item.id"
          class="-mx-2 flex items-center gap-3 rounded-md px-2 py-2"
          :class="item.invoice_id || item.gift_id ? 'cursor-pointer hover:bg-elevated/60' : ''"
          :role="item.invoice_id || item.gift_id ? 'button' : undefined"
          :tabindex="item.invoice_id || item.gift_id ? 0 : undefined"
          @click="item.invoice_id || item.gift_id ? (preview = item) : undefined"
          @keydown.enter="item.invoice_id || item.gift_id ? (preview = item) : undefined"
        >
          <UIcon
            :name="item.kind === 'gift' ? 'i-lucide-gift' : 'i-lucide-plus'"
            class="size-4 shrink-0"
            :class="item.kind === 'gift' ? 'text-primary' : 'text-muted'"
          />
          <div class="min-w-0 flex-1">
            <p class="text-sm">{{ itemsLabel(item) }}</p>
            <p class="truncate text-xs text-muted">
              {{ formatDay(item.created_at) }}<template v-if="item.number"> · {{ item.number }}</template>
              <template v-if="item.credits_granted && (item.posts || item.videos)"> · {{ t('admin.packageState.creditsGranted', { count: item.credits_granted }) }}</template>
            </p>
          </div>
          <span class="text-sm tabular-nums" :class="item.kind === 'gift' ? 'text-muted line-through' : ''">
            {{ formatMoney(item.value_cents, item.currency) }}
          </span>
          <UBadge
            :color="statusColor[item.payment_status]"
            variant="subtle"
            size="sm"
            :label="item.payment_status === 'gift' ? t('admin.billing.kindGift') : t(`admin.billing.payment.status.${item.payment_status}`)"
          />
          <UIcon v-if="item.invoice_id || item.gift_id" name="i-lucide-chevron-right" class="size-4 shrink-0 text-muted" />
        </li>
      </ul>
    </div>
  </div>

  <UModal
    :open="!!preview"
    :title="preview?.number ?? ''"
    :description="preview ? itemsLabel(preview) : ''"
    :ui="{ content: 'sm:max-w-4xl h-[90dvh]', body: 'p-0 sm:p-0 flex-1' }"
    @update:open="(value: boolean) => { if (!value) preview = null }"
  >
    <template #body>
      <iframe v-if="preview" :src="documentUrl(preview, true)" :title="preview.number ?? ''" class="h-full min-h-[70dvh] w-full border-0" />
    </template>
    <template #footer>
      <UButton
        v-if="preview"
        :to="documentUrl(preview, false)"
        external
        download
        icon="i-lucide-download"
        color="neutral"
        variant="outline"
        label="PDF"
      />
    </template>
  </UModal>

  <UModal
    :open="!!mode"
    :title="mode === 'gift' ? t('admin.packageState.giftTitle') : t('admin.packageState.addTitle')"
    :description="`${organizationName} · ${pkg.name}`"
    :ui="{ content: 'sm:max-w-lg' }"
    @update:open="(value: boolean) => { if (!value) mode = null }"
  >
    <template #body>
      <div class="space-y-5">
        <UAlert
          :color="mode === 'gift' ? 'primary' : 'neutral'"
          variant="subtle"
          :icon="mode === 'gift' ? 'i-lucide-gift' : 'i-lucide-receipt'"
          :description="mode === 'gift' ? t('admin.packageState.giftDescription') : t('admin.packageState.addDescription')"
        />

        <div class="space-y-3">
          <div v-for="kind in kinds" :key="kind" class="flex items-center gap-3">
            <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-elevated">
              <UIcon :name="icons[kind]" class="size-4 text-muted" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium">{{ t(`admin.packageState.${kind}`) }}</p>
              <p class="text-xs text-muted">{{ t('admin.packageState.each', { price: formatMoney(rates[kind], pkg.currency) }) }}</p>
            </div>
            <LiveInputNumber v-model="amounts[kind]" :min="0" :max="kind === 'credits' ? 1000000 : 1000" :step="steps[kind]" :step-snapping="false" class="w-40" />
          </div>
        </div>

        <USeparator />

        <UFormField v-if="mode === 'paid'" :label="t('admin.packageState.price')" :help="customPrice === null ? t('admin.packageState.priceHint') : undefined">
          <div class="flex items-center gap-2">
            <LiveInputNumber
              :model-value="customPrice ?? rateValueCents / 100"
              :min="0"
              :step="0.01"
              :format-options="{ style: 'currency', currency: pkg.currency }"
              class="flex-1"
              @update:model-value="(value: number | undefined) => { customPrice = value ?? null }"
            />
            <UButton
              v-if="customPrice !== null"
              color="neutral"
              variant="outline"
              :label="t('admin.packageState.useRates')"
              @click="customPrice = null"
            />
          </div>
        </UFormField>

        <UFormField v-else :label="t('admin.packageState.reason')" required>
          <UTextarea
            v-model="reason"
            :maxlength="500"
            :rows="2"
            :placeholder="t('admin.packageState.reasonPlaceholder')"
            class="w-full"
          />
        </UFormField>

        <div class="rounded-lg bg-elevated/60 p-3 text-sm">
          <div class="flex items-center justify-between">
            <span class="text-muted">{{ t('admin.packageState.value') }}</span>
            <span class="tabular-nums" :class="mode === 'gift' ? 'line-through text-muted' : 'font-semibold'">
              {{ formatMoney(valueCents, pkg.currency) }}
            </span>
          </div>
          <div v-if="mode === 'gift'" class="mt-1 flex items-center justify-between">
            <span class="text-muted">{{ t('admin.packageState.toPay') }}</span>
            <span class="font-semibold tabular-nums">{{ formatMoney(0, pkg.currency) }}</span>
          </div>
          <div v-if="creditsToBalance > 0" class="mt-1 flex items-center justify-between">
            <span class="text-muted">{{ t('admin.packageState.creditsToBalance') }}</span>
            <span class="font-medium tabular-nums text-primary">+{{ creditsToBalance }}</span>
          </div>
          <p class="mt-2 text-xs text-muted">
            {{ nothingChosen
              ? t('admin.packageState.chooseSomething')
              : mode === 'gift'
                ? t('admin.packageState.summaryGift', { items: itemsLabel(amounts) })
                : t('admin.packageState.summaryPaid', { amount: formatMoney(valueCents, pkg.currency) }) }}
          </p>
        </div>

        <UAlert v-if="error" color="error" variant="subtle" :description="error" />
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="outline" :label="t('admin.packages.cancel')" @click="mode = null" />
        <UButton
          :icon="mode === 'gift' ? 'i-lucide-gift' : 'i-lucide-plus'"
          :loading="saving"
          :disabled="!canSave"
          :label="mode === 'gift' ? t('admin.packageState.confirmGift') : t('admin.packageState.confirmAdd')"
          @click="save"
        />
      </div>
    </template>
  </UModal>
</template>
