<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'workspace' })
const route = useRoute()
const { t } = useI18n()
useSeoMeta({ title: () => `${t('content.editPost')} · Rrit` })
</script>
<template><ContentEditor :id="String(route.params.id)" :key="String(route.params.id)" /></template>
