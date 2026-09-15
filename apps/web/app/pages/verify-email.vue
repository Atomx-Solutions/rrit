<script setup lang="ts">
definePageMeta({ layout: 'auth' })
const { t } = useI18n()
useSeoMeta({ title: () => `${t('auth.title.verify')} · Rrit`, robots: 'noindex' })
</script>
<template><AuthSurface mode="verify" /></template>
