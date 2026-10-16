<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'superadmin' })

const { t } = useI18n()
useSeoMeta({ title: () => `${t('admin.nav.invitations')} · Framic Admin`, robots: 'noindex, nofollow' })
</script>

<template>
  <AdminPage :title="t('admin.nav.invitations')">
    <AdminOrganizationInvite />
  </AdminPage>
</template>
