<script setup lang="ts">
definePageMeta({ layout: 'auth' })
const { t } = useI18n()
useSeoMeta({ title: () => `${t('auth.title.login')} · Framic`, robots: 'noindex' })
</script>
<template><AuthSurface mode="login" /></template>
