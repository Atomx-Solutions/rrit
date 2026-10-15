<script setup lang="ts">
import { lowCreditAction, showLowCreditReminder } from '~/utils/low-credit'

const props = defineProps<{
  spendable?: number | null
  threshold?: number
  hasActivePackage?: boolean
}>()
const { t } = useI18n()
const { base } = useWorkspace()
const { ask } = useBillingRequest()
// Session-scoped: a dismissal ends with the browser session.
const storageKey = computed(() => `rrit:low-credit-dismissed:${base.value}`)
const dismissedAt = ref<number | null>(null)
// A business with no credit balance yet reports null; for the reminder that is
// an empty balance, not an unknown one, so it can still be dismissed.
const balance = computed(() => (props.spendable === undefined ? undefined : Number(props.spendable ?? 0)))
onMounted(() => {
  try {
    const stored = sessionStorage.getItem(storageKey.value)
    dismissedAt.value = stored === null ? null : Number(stored)
  } catch {
    dismissedAt.value = null
  }
})
// A dismissal belongs to the balance it was made at. Once credits arrive (a new
// package or a top-up) it no longer applies, so a later shortfall shows again.
watch(balance, (current) => {
  if (current === undefined || dismissedAt.value === null || current <= dismissedAt.value) return
  dismissedAt.value = null
  try {
    sessionStorage.removeItem(storageKey.value)
  } catch {
    // Without storage the dismissal is already gone from memory.
  }
})
const visible = computed(() =>
  balance.value !== undefined
  && props.threshold !== undefined
  && showLowCreditReminder(balance.value, props.threshold, dismissedAt.value),
)
const action = computed(() => lowCreditAction(props.hasActivePackage))
const copy = computed(() => action.value === 'request-package'
  ? { description: t('lowCredit.requestPackageDescription'), label: t('lowCredit.requestPackage'), request: 'package' }
  : { description: t('lowCredit.requestCreditsDescription'), label: t('lowCredit.requestCredits'), request: 'credits' })
function dismiss() {
  if (balance.value === undefined) return
  dismissedAt.value = balance.value
  try {
    sessionStorage.setItem(storageKey.value, String(balance.value))
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
        <p class="text-sm font-medium">{{ t('lowCredit.title', { credits: balance ?? 0 }) }}</p>
        <p class="text-xs text-muted mt-1">
          {{ copy.description }}
        </p>
      </div>
    </div>
    <div class="flex items-center gap-1">
      <!-- Packages and credits are sold through a request the team answers, so
           the reminder opens the right request on the billing page. -->
      <UButton
        :to="`${base}/billing`"
        :data-action="action"
        color="warning"
        variant="subtle"
        size="sm"
        :label="copy.label"
        @click="ask(copy.request === 'package' ? 'package' : 'credits')"
      />
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
