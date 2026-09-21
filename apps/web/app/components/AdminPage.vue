<script setup lang="ts">
import { adminDashboardKey } from '~/utils/dashboard'

defineProps<{ title: string }>()
const route = useRoute()
const { t } = useI18n()
const admin = inject(adminDashboardKey)
if (!admin) throw new Error('AdminPage requires the admin layout')
const { sidebarOpen } = admin
</script>
<template>
  <UDashboardPanel :id="`admin-${route.path}`" :ui="{ root: 'min-w-0 bg-default' }">
    <template #header>
      <UDashboardNavbar
        :title="title"
        :toggle="false"
        :ui="{ root: 'h-[52px] px-3', title: 'text-sm font-semibold truncate' }"
      >
        <template #leading>
          <UButton
            icon="i-lucide-panel-left"
            color="neutral"
            variant="ghost"
            :aria-label="t('nav.toggle')"
            :aria-expanded="sidebarOpen"
            aria-controls="admin-navigation"
            class="hidden lg:inline-flex"
            @click="sidebarOpen = !sidebarOpen"
          />
          <UButton
            icon="i-lucide-menu"
            color="neutral"
            variant="ghost"
            :aria-label="t('nav.open')"
            :aria-expanded="sidebarOpen"
            aria-controls="admin-navigation"
            data-testid="admin-menu-toggle"
            class="lg:hidden"
            @click="sidebarOpen = true"
          />
        </template>
        <template #right>
          <UColorModeButton :aria-label="t('dashboard.changeAppearance')" color="neutral" variant="ghost" />
        </template>
      </UDashboardNavbar>
    </template>
    <template #body>
      <slot />
    </template>
  </UDashboardPanel>
</template>
