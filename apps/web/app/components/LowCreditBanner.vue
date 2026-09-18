<script setup lang="ts">
import { lowCreditAction, showLowCreditReminder } from '~/utils/low-credit'

const props = defineProps<{
  spendable?: number
  threshold?: number
  hasActivePackage?: boolean
}>()
const { t } = useI18n()
const { base } = useWorkspace()
// Session-scoped: a dismissal ends with the browser session.
const storageKey = computed(() => `rrit:low-credit-dismissed:${base.value}`)
const dismissedAt = ref<number | null>(null)
onMounted(() => {
  try {
    const stored = sessionStorage.getItem(storageKey.value)
    dismissedAt.value = stored === null ? null : Number(stored)
  } catch {
    dismissedAt.value = null
  }
})
const visible = computed(() =>
  props.spendable !== undefined
  && props.threshold !== undefined
  && showLowCreditReminder(props.spendable, props.threshold, dismissedAt.value),
)
const action = computed(() => lowCreditAction(!!props.hasActivePackage))
function dismiss() {
  if (props.spendable === undefined) return
  dismissedAt.value = props.spendable
  try {
    sessionStorage.setItem(storageKey.value, String(props.spendable))
  } catch {
    // Without storage the dismissal still holds until the page reloads.
  }
}
</script>
<template>
  <div
    v-if="visible"
    role="status"
    data-testid="low-credit-banner"
    class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3"
  >
    <div class="flex items-start gap-3">
      <UIcon name="i-lucide-coins" class="size-4 mt-0.5 text-warning shrink-0" />
      <div>
        <p class="text-sm font-medium">{{ t('lowCredit.title', { credits: spendable ?? 0 }) }}</p>
        <p class="text-xs text-muted mt-1">
          {{ action === 'top-up' ? t('lowCredit.topUpDescription') : t('lowCredit.choosePlanDescription') }}
        </p>
      </div>
    </div>
    <div class="flex items-center gap-1">
      <UButton
        :to="action === 'top-up' ? `${base}/billing#credit-top-up-section` : `${base}/billing#plans`"
        :data-action="action"
        color="warning"
        size="sm"
      >
        {{ action === 'top-up' ? t('lowCredit.buyCredits') : t('lowCredit.choosePlan') }}
      </UButton>
      <UButton
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        size="sm"
        :aria-label="t('lowCredit.dismiss')"
        @click="dismiss"
      />
    </div>
  </div>
</template>
