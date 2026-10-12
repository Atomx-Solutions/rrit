<script setup lang="ts">
definePageMeta({ layout: 'auth', middleware: 'workspace' })
const { t } = useI18n()
useSeoMeta({ title: () => `${t('onboarding.business')} · Framic`, robots: 'noindex' })
</script>
<template><BusinessOnboarding /></template>
