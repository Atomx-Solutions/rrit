<script setup lang="ts">
definePageMeta({ layout: 'public' })
const { t } = useI18n()
useSeoMeta({ title: () => `${t('policy.termsTitle')} · Rrit` })
</script>
<template><PolicyPage kind="terms" /></template>
