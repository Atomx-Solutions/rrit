<script setup lang="ts">
import { dashboardKey } from '~/utils/dashboard'
defineProps<{ title: string; description?: string; eyebrow?: string }>()
const route = useRoute()
const chrome = inject(dashboardKey)
if (!chrome) throw new Error('DashboardPage requires the dashboard layout')
const { sidebarOpen, notificationsOpen } = chrome
const { storageError, exportData, syncing } = useWorkspace()
</script>
<template>
  <UDashboardPanel
    :id="`page-${route.path}`"
    :ui="{ root: 'min-w-0 bg-default', body: 'p-0 sm:p-0 gap-0' }"
  >
    <template #header>
      <UDashboardNavbar
        :title="title"
        :toggle="false"
        :ui="{
          root: 'min-h-16 h-auto flex-wrap gap-y-2 px-4 sm:px-6 py-3 md:py-0 md:h-16',
          left: 'min-w-0 flex-1',
          title: 'text-base font-semibold truncate',
          right: 'gap-2',
        }"
      >
        <template #leading>
          <UButton
            icon="i-lucide-panel-left"
            color="neutral"
            variant="ghost"
            aria-label="Zvogëlo ose zgjero menunë"
            :aria-expanded="sidebarOpen"
            aria-controls="navigation"
            class="hidden lg:inline-flex"
            @click="sidebarOpen = !sidebarOpen"
          />
          <UButton
            icon="i-lucide-menu"
            color="neutral"
            variant="ghost"
            aria-label="Hap navigimin"
            :aria-expanded="sidebarOpen"
            aria-controls="navigation"
            class="lg:hidden"
            @click="sidebarOpen = true"
          />
        </template>
        <template #right>
          <div class="hidden xl:flex items-center flex-wrap gap-2"><slot name="actions" /></div>
          <USeparator
            v-if="$slots.actions"
            orientation="vertical"
            class="hidden xl:block h-5 mx-1"
          />
          <UDashboardSearchButton
            :collapsed="true"
            aria-label="Kërko në hapësirë"
            color="neutral"
            variant="ghost"
            class="lg:hidden"
          />
          <UColorModeButton aria-label="Ndrysho pamjen" color="neutral" variant="ghost" />
          <UButton
            icon="i-lucide-bell"
            aria-label="Njoftimet"
            color="neutral"
            variant="ghost"
            @click="notificationsOpen = true"
          />
        </template>
      </UDashboardNavbar>
      <div
        v-if="$slots.actions"
        class="xl:hidden flex flex-wrap items-center gap-2 px-4 sm:px-6 pb-3 border-b border-default"
      >
        <slot name="actions" />
      </div>
      <UDashboardToolbar
        v-if="$slots.toolbar || description"
        :ui="{ root: 'min-h-12 px-4 sm:px-6 py-2 gap-3 flex-wrap', left: 'min-w-0 flex-1' }"
      >
        <template #left
          ><slot name="toolbar"
            ><p class="text-sm text-muted leading-relaxed">{{ description }}</p></slot
          ></template
        >
      </UDashboardToolbar>
    </template>
    <template #body>
      <div class="page dashboard-page-body space-y-6">
        <UAlert
          v-if="storageError"
          color="error"
          :title="storageError"
          class="mb-5"
          :actions="[{ label: 'Eksporto kopjen', onClick: exportData }]"
        />
        <TrialBanner />
        <slot />
      </div>
    </template>
    <template #footer>
      <div
        class="flex items-center gap-2 border-t border-default px-4 sm:px-6 py-2 text-xs text-muted bg-elevated/25"
      >
        <UIcon name="i-lucide-info" class="size-3.5 shrink-0" />
        <span role="status">{{
          syncing ? 'Duke ruajtur ndryshimet…' : 'Hapësira private e biznesit'
        }}</span>
      </div>
    </template>
  </UDashboardPanel>
</template>
