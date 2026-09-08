<script setup lang="ts">
const { base } = useWorkspace()
const { data: trial, refresh, error } = await useFetch('/api/trial', { key: 'trial' })
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => refresh(), 60000)
})
onBeforeUnmount(() => clearInterval(timer))
const remaining = computed(() => {
  const hours = Math.ceil((trial.value?.secondsRemaining || 0) / 3600)
  return hours >= 24 ? `${Math.ceil(hours / 24)} ditë` : `${hours} orë`
})
</script>
<template>
  <UAlert
    v-if="error"
    color="warning"
    variant="outline"
    title="Gjendja e trial-it nuk u ngarkua"
    :actions="[{ label: 'Provo sërish', variant: 'outline', onClick: () => refresh() }]"
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
              ? 'Trial falas · ' + remaining + ' të mbetura'
              : trial.state === 'blocked' || trial.state === 'revoked'
                ? 'Trial-i është përdorur më parë'
                : 'Trial-i nuk është aktiv'
          }}
        </p>
        <p class="text-xs text-muted mt-1">
          {{
            trial.state === 'active'
              ? 'Të gjitha shërbimet e aktivizuara përfshihen. Pa rinovim automatik.'
              : 'Postimet dhe të dhënat e tua mbeten të lexueshme dhe mund t’i eksportosh.'
          }}
        </p>
        <p v-if="trial.expiresAt && trial.state === 'active'" class="text-xs text-muted mt-1">
          Përfundon më
          {{
            new Intl.DateTimeFormat('sq', {
              dateStyle: 'medium',
              timeStyle: 'short',
              hourCycle: 'h23',
              timeZone: 'Europe/Belgrade',
            }).format(new Date(trial.expiresAt))
          }}
        </p>
      </div>
    </div>
    <UButton :to="base + '/billing'" variant="link" color="neutral" size="sm">Shiko planin</UButton>
  </div>
</template>
