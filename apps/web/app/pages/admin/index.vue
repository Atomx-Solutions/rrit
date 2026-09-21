<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'superadmin' })
useSeoMeta({ title: 'Admin · Rrit', robots: 'noindex, nofollow' })
const { t } = useI18n()
const { data: admin } = await useFetch('/api/admin/me', { key: 'admin-me' })
</script>
<template>
  <AdminPage :title="t('admin.nav.overview')">
    <UCard :title="t('admin.overviewTitle')" :description="admin?.email" />
  </AdminPage>
</template>
