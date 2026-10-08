<script setup lang="ts">
const { t, language } = useI18n()
const { base } = useWorkspace()
const { data: usage, error } = useHeaderUsage()
const trial = computed(() => usage.value?.trial)
const { showError } = useFormFeedback()
watch(error, (value) => {
  if (value) showError(t('trial.loadError'), 'warning')
}, { immediate: true })
const remaining = computed(() => {
  const hours = Math.ceil((trial.value?.secondsRemaining || 0) / 3600)
  return hours >= 24
    ? `${Math.ceil(hours / 24)} ${t('trial.days')}`
    : `${hours} ${t('trial.hours')}`
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
            new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'sq-XK', {
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
