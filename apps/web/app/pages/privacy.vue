<script setup lang="ts">
definePageMeta({ layout: 'public' })
const { t } = useI18n()
useSeoMeta({ title: () => `${t('policy.privacyTitle')} · Rrit` })
</script>
<template><PolicyPage kind="privacy" /></template>
