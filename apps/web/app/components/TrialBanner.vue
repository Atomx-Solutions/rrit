<script setup lang="ts">
const { t, language } = useI18n()
const { base } = useWorkspace()
const { data: trial, refresh, error } = await useFetch('/api/trial', { key: 'trial' })
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => refresh(), 60000)
})
onBeforeUnmount(() => clearInterval(timer))
const remaining = computed(() => {
  const hours = Math.ceil((trial.value?.secondsRemaining || 0) / 3600)
  return hours >= 24
    ? `${Math.ceil(hours / 24)} ${t('trial.days')}`
    : `${hours} ${t('trial.hours')}`
})
</script>
<template>
  <UAlert
    v-if="error"
    color="warning"
    variant="outline"
    :title="t('trial.loadError')"
    :actions="[{ label: t('common.retry'), variant: 'outline', onClick: () => refresh() }]"
  />
  <div
    v-else-if="trial && !trial.paid"
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
              dateStyle: 'medium',
              timeStyle: 'short',
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
