<script setup lang="ts">
definePageMeta({ layout: 'public' })
const { t } = useI18n()
const requestUrl = useRequestURL()
const ogImageUrl = computed(() => new URL('/og-image.png', requestUrl).toString())
useSeoMeta({
  title: () => `${t('policy.refundTitle')} · Framic`,
  description: () => t('policy.refundDescription'),
  ogTitle: () => `${t('policy.refundTitle')} · Framic`,
  ogDescription: () => t('policy.refundDescription'),
  ogImage: ogImageUrl,
  ogType: 'website',
})
</script>
<template><PolicyPage kind="refund" /></template>
