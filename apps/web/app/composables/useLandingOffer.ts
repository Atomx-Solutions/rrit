export function useLandingOffer() {
  const { t } = useI18n()
  const {
    data: capabilities,
    error,
    refresh,
  } = useFetch('/api/capabilities', {
    key: 'public-capabilities',
  })
  const trialDuration = computed(() => {
    const hours = capabilities.value?.trialHours
    if (!hours || hours <= 0) return null
    return hours % 24 === 0
      ? t('public.trialDurationDays', { count: hours / 24 })
      : t('public.trialDurationHours', { count: hours })
  })
  const canRegister = computed(() => capabilities.value?.registration === true)
  const trialLabel = computed(() =>
    trialDuration.value ? t('public.tryFree', { duration: trialDuration.value }) : t('public.createBusinessAccount'),
  )
  return { capabilities, error, refresh, trialDuration, canRegister, trialLabel }
}
