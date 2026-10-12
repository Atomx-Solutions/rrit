<script setup lang="ts">
definePageMeta({ layout: 'public' })
const { t } = useI18n()
const requestUrl = useRequestURL()
const ogImageUrl = computed(() => new URL('/og-image.png', requestUrl).toString())
useSeoMeta({
  title: () => `${t('policy.termsTitle')} · Framic`,
  description: () => t('policy.termsDescription'),
  ogTitle: () => `${t('policy.termsTitle')} · Framic`,
  ogDescription: () => t('policy.termsDescription'),
  ogImage: ogImageUrl,
  ogType: 'website',
})
</script>
<template><PolicyPage kind="terms" /></template>
