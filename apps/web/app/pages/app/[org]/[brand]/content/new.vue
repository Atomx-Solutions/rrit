<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'workspace' })
const { t } = useI18n()
useSeoMeta({ title: () => `${t('content.createPost')} · Rrit` })
</script>
<template><ContentEditor /></template>
