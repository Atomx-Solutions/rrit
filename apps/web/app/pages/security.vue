<script setup lang="ts">
definePageMeta({ layout: 'public' })
const { t } = useI18n()
useSeoMeta({ title: () => `${t('policy.securityTitle')} · Rrit` })
</script>
<template><PolicyPage kind="security" /></template>
