<script setup lang="ts">
const { t, locale } = useI18n()
const { base } = useWorkspace()
const { data: usage, error } = useHeaderUsage()
const trial = computed(() => usage.value?.trial)
const { showError } = useFormFeedback()
watch(error, (value) => {
  if (value) showError(t('trial.loadError'), 'warning')
}, { immediate: true })
// The countdown follows the clock rather than the moment the usage was loaded,
// and shows only whole days left: two days and five hours is two days.
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  clock = setInterval(() => (now.value = Date.now()), 60_000)
})
onBeforeUnmount(() => clearInterval(clock))
const secondsLeft = computed(() => {
  const expiresAt = trial.value?.expiresAt ? Date.parse(trial.value.expiresAt) : NaN
  return Number.isFinite(expiresAt)
    ? Math.max(0, (expiresAt - now.value) / 1000)
    : trial.value?.secondsRemaining || 0
})
// When the trial runs out on screen, reload it so the banner shows its end.
watch(secondsLeft, (seconds, previous) => {
  if (seconds === 0 && previous > 0) void refreshCreditBalance()
})
const remaining = computed(() => {
  const hours = secondsLeft.value / 3600
  return hours >= 24
    ? `${Math.floor(hours / 24)} ${t('trial.days')}`
    : `${Math.max(1, Math.floor(hours))} ${t('trial.hours')}`
})
</script>
<template>
  <div
    v-if="trial && !trial.paid"
    class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-default px-4 py-3"
  >
    <div class="flex items-start gap-3">
      <UIcon
        :name="trial.state === 'active' ? 'i-lucide-clock-3' : 'i-lucide-info'"
        class="size-4 mt-0.5 text-muted shrink-0"
      />
      <div>
        <p class="text-sm font-medium">
          {{
            trial.state === 'active'
              ? t('trial.free', { remaining })
              : trial.state === 'blocked' || trial.state === 'revoked'
                ? t('trial.used')
                : t('trial.inactive')
          }}
        </p>
        <p class="text-xs text-muted mt-1">
          {{
            trial.state === 'active'
              ? t('trial.activeDescription')
              : t('trial.endedDescription')
          }}
        </p>
        <p v-if="trial.expiresAt && trial.state === 'active'" class="text-xs text-muted mt-1">
          {{ t('trial.endsAt') }}
          {{
            new Intl.DateTimeFormat(locale, {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              hourCycle: 'h23',
              timeZone: 'Europe/Belgrade',
            }).format(new Date(trial.expiresAt))
          }}
        </p>
      </div>
    </div>
    <UButton :to="base + '/billing'" variant="link" color="neutral" size="sm">{{ t('trial.viewPlan') }}</UButton>
  </div>
</template>
