<script setup lang="ts">
/**
 * One request dialog for everything added to a running package (posts,
 * videos, credits): pick an amount, see what it costs, send. The team answers
 * with an offer the customer pays through Paddle.
 */
const props = withDefaults(defineProps<{
  title: string
  description: string
  icon: string
  label: string
  unitPrice: number
  submitLabel: string
  formatMoney: (value: number) => string
  loading?: boolean
  min?: number
  max?: number
  withMessage?: boolean
  note?: string
}>(), { loading: false, min: 1, max: 1000, withMessage: false, note: '' })
const open = defineModel<boolean>('open', { default: false })
const amount = defineModel<number>('amount', { required: true })
const message = defineModel<string>('message', { default: '' })
const emit = defineEmits<{ submit: [] }>()
const { t } = useI18n()
const total = computed(() => amount.value * props.unitPrice)
const valid = computed(() => amount.value >= Math.max(props.min, 1))
</script>

<template>
  <UModal v-model:open="open" :ui="{ footer: 'p-4 sm:p-5' }">
    <template #content>
      <div class="flex flex-col">
        <div class="flex items-start gap-3 p-5 pb-0">
          <span class="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <UIcon :name="icon" class="size-5" />
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
            :aria-label="t('common.cancel')"
            @click="open = false"
          />
        </div>

        <div class="space-y-4 p-5">
          <div class="rounded-lg border border-default p-4">
            <p class="text-center text-xs font-medium uppercase tracking-wide text-muted">{{ label }}</p>
            <LiveInputNumber
              v-model="amount"
              :min="min"
              :max="max"
              :aria-label="label"
              variant="none"
              size="xl"
              class="mt-2 w-full [&_input:focus-visible]:shadow-none!"
              :ui="{ base: 'text-center text-4xl font-semibold tabular-nums', increment: 'pe-0', decrement: 'ps-0' }"
              :increment="{ color: 'primary', variant: 'soft', size: 'lg' }"
              :decrement="{ color: 'neutral', variant: 'soft', size: 'lg' }"
            />
            <p v-if="unitPrice > 0" class="mt-2 text-center text-xs text-muted tabular-nums">
              {{ formatMoney(unitPrice) }} × {{ amount }}
            </p>
          </div>

          <div
            v-if="unitPrice > 0"
            class="flex items-center justify-between gap-3 rounded-lg bg-primary/10 px-4 py-3 ring-1 ring-primary/20 ring-inset"
          >
            <span class="text-sm text-toned">{{ t('request.estimateLabel') }}</span>
            <span class="text-xl font-semibold tabular-nums text-highlighted">{{ formatMoney(total) }}</span>
          </div>

          <UTextarea
            v-if="withMessage"
            v-model="message"
            :placeholder="t('request.message')"
            :rows="2"
            :maxlength="2000"
            class="w-full"
          />
          <p v-if="note" class="text-xs text-muted">{{ note }}</p>
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
