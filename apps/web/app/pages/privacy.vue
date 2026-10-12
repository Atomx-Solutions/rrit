<script setup lang="ts">
definePageMeta({ layout: 'public' })
const { t } = useI18n()
const requestUrl = useRequestURL()
const ogImageUrl = computed(() => new URL('/og-image.png', requestUrl).toString())
useSeoMeta({
  title: () => `${t('policy.privacyTitle')} · Framic`,
  description: () => t('policy.privacyDescription'),
  ogTitle: () => `${t('policy.privacyTitle')} · Framic`,
  ogDescription: () => t('policy.privacyDescription'),
  ogImage: ogImageUrl,
  ogType: 'website',
})
</script>
<template><PolicyPage kind="privacy" /></template>
