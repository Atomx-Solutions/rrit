<script setup lang="ts">
/**
 * One request dialog for everything added to a running package: posts, videos
 * and credits side by side, each with its own amount (zero leaves it out), one
 * total and one send. The team answers with a single offer paid through Paddle.
 */
export type AddOnKind = 'posts' | 'videos' | 'credits'
export type AddOnItem = { kind: AddOnKind; label: string; icon: string; unitPrice: number; max: number; defaultAmount: number }

const props = withDefaults(defineProps<{
  title: string
  description: string
  items: AddOnItem[]
  /** The kind the dialog was opened for; each other kind joins only when chosen. */
  primary: AddOnKind
  submitLabel: string
  formatMoney: (value: number) => string
  loading?: boolean
  note?: string
}>(), { loading: false, note: '' })
const open = defineModel<boolean>('open', { default: false })
const amounts = defineModel<Record<AddOnKind, number>>('amounts', { required: true })
const message = defineModel<string>('message', { default: '' })
const emit = defineEmits<{ submit: [] }>()
const { t } = useI18n()
const total = computed(() => props.items.reduce((sum, item) => sum + (amounts.value[item.kind] || 0) * item.unitPrice, 0))
const valid = computed(() => props.items.some(item => (amounts.value[item.kind] || 0) > 0))
const withCredits = computed(() => props.items.some(item => item.kind === 'credits' && amounts.value.credits > 0))
// The kind the dialog was opened for comes first and stays; each other kind
// joins only once chosen (or when it still carries an amount) and can be
// taken out again with its own X.
const chosen = ref<AddOnKind[]>([])
watch(open, (value) => {
  if (value) chosen.value = props.items
    .filter(item => item.kind !== props.primary && (amounts.value[item.kind] || 0) > 0)
    .map(item => item.kind)
}, { immediate: true })
const visibleItems = computed(() => [props.primary, ...chosen.value]
  .map(kind => props.items.find(item => item.kind === kind))
  .filter((item): item is AddOnItem => !!item))
const hiddenItems = computed(() => props.items.filter(item => item.kind !== props.primary && !chosen.value.includes(item.kind)))
function choose(item: AddOnItem) {
  chosen.value = [...chosen.value, item.kind]
  setAmount(item.kind, item.defaultAmount)
}
function remove(kind: AddOnKind) {
  chosen.value = chosen.value.filter(value => value !== kind)
  setAmount(kind, 0)
}
function setAmount(kind: AddOnKind, value: number | null | undefined) {
  amounts.value = { ...amounts.value, [kind]: Math.max(0, Number(value) || 0) }
}
</script>

<template>
  <!-- Closes only through its X, so a stray click outside never drops the amounts. -->
  <UModal v-model:open="open" :dismissible="false">
    <template #content>
      <div class="flex flex-col">
        <div class="flex items-start gap-3 p-5 pb-0">
          <span class="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <UIcon :name="items.find(item => item.kind === primary)?.icon || 'i-lucide-package-plus'" class="size-5" />
          </span>
          <div class="min-w-0 flex-1">
            <h2 class="text-base font-semibold text-highlighted">{{ title }}</h2>
            <p class="mt-0.5 text-sm text-muted">{{ description }}</p>
          </div>
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="sm"
            :aria-label="t('common.close')"
            @click="open = false"
          />
        </div>

        <div class="space-y-3 p-5">
          <div
            v-for="item in visibleItems"
            :key="item.kind"
            class="flex flex-wrap items-center gap-2 rounded-lg border p-3 transition-colors sm:flex-nowrap sm:gap-3"
            :class="amounts[item.kind] > 0 ? 'border-primary/40 bg-primary/5' : 'border-default'"
            :data-testid="`add-on-${item.kind}`"
          >
            <span class="hidden size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary sm:grid">
              <UIcon :name="item.icon" class="size-4" />
            </span>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">{{ item.label }}</p>
              <p v-if="item.unitPrice > 0" class="text-xs text-muted tabular-nums">
                {{ formatMoney(item.unitPrice) }} × {{ amounts[item.kind] || 0 }}
              </p>
            </div>
            <LiveInputNumber
              :model-value="amounts[item.kind] || 0"
              :min="1"
              :max="item.max"
              :aria-label="item.label"
              variant="none"
              size="lg"
              class="order-last w-full shrink-0 sm:order-none sm:w-36 [&_input:focus-visible]:shadow-none!"
              :ui="{ base: 'text-center text-lg font-semibold tabular-nums', increment: 'pe-0', decrement: 'ps-0' }"
              :increment="{ color: 'primary', variant: 'soft' }"
              :decrement="{ color: 'neutral', variant: 'soft' }"
              @update:model-value="setAmount(item.kind, $event)"
            />
            <UButton
              v-if="item.kind !== primary"
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              size="xs"
              :aria-label="t('billing.removeItem', { item: item.label })"
              :data-testid="`add-on-remove-${item.kind}`"
              @click="remove(item.kind)"
            />
          </div>

          <div v-if="hiddenItems.length" class="flex flex-wrap items-center gap-2">
            <span class="text-xs text-muted">{{ t('billing.addItems') }}</span>
            <UButton
              v-for="item in hiddenItems"
              :key="item.kind"
              :label="item.label"
              :icon="item.icon"
              color="primary"
              variant="soft"
              size="sm"
              :data-testid="`add-on-choose-${item.kind}`"
              @click="choose(item)"
            />
          </div>

          <div
            class="flex items-center justify-between gap-3 rounded-lg bg-primary/10 px-4 py-3 ring-1 ring-primary/20 ring-inset"
          >
            <span class="text-sm text-toned">{{ t('request.estimateLabel') }}</span>
            <span class="text-xl font-semibold tabular-nums text-highlighted">{{ formatMoney(total) }}</span>
          </div>

          <UTextarea
            v-if="withCredits"
            v-model="message"
            :placeholder="t('request.message')"
            :rows="2"
            :maxlength="2000"
            class="w-full"
          />
          <p v-if="note && withCredits" class="text-xs text-muted">{{ note }}</p>
        </div>

        <div class="border-t border-default p-4 sm:p-5">
          <UButton
            :label="submitLabel"
            trailing-icon="i-lucide-send"
            size="lg"
            block
            :loading="loading"
            :disabled="!valid"
            @click="emit('submit')"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
