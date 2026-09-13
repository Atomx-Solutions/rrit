<script setup lang="ts">
import { dashboardKey } from '~/utils/dashboard'
defineProps<{ title: string; description?: string; eyebrow?: string }>()
const route = useRoute()
const chrome = inject(dashboardKey)
if (!chrome) throw new Error('DashboardPage requires the dashboard layout')
const { sidebarOpen, notificationsOpen } = chrome
const { base, storageError, exportData, syncing } = useWorkspace()
const { data: headerUsage, refresh: refreshHeaderUsage } = await useFetch('/api/usage', {
  key: 'header-credit-balance',
})
const credits = computed(() => headerUsage.value?.credits.available)
let creditTimer: ReturnType<typeof setInterval>
onMounted(() => {
  creditTimer = setInterval(() => refreshHeaderUsage(), 30_000)
})
onBeforeUnmount(() => clearInterval(creditTimer))
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
          root: 'min-h-[52px] h-auto flex-wrap gap-y-1 px-3 py-1.5 md:py-0 md:h-[52px]',
          left: 'min-w-0 flex-1',
          title: 'text-sm font-semibold truncate',
          right: 'gap-1.5',
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
          <UTooltip text="Bilanci për shërbimet AI">
            <UButton
              :to="`${base}/billing`"
              color="neutral"
              variant="soft"
              size="sm"
              icon="i-lucide-coins"
              :label="credits === undefined ? '— kredi' : `${credits} kredi`"
              class="tabular-nums"
            />
          </UTooltip>
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
        class="xl:hidden flex flex-wrap items-center gap-1.5 px-3 sm:px-4 pb-2 border-b border-default"
      >
        <slot name="actions" />
      </div>
      <UDashboardToolbar
        v-if="$slots.toolbar || description"
        :ui="{ root: 'min-h-9 px-3 py-1 gap-2 flex-wrap', left: 'min-w-0 flex-1' }"
      >
        <template #left
          ><slot name="toolbar"
            ><p class="text-xs text-muted leading-relaxed">{{ description }}</p></slot
          ></template
        >
      </UDashboardToolbar>
    </template>
    <template #body>
      <div class="page dashboard-page-body space-y-4">
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
        class="flex items-center gap-2 border-t border-default px-3 sm:px-4 py-1.5 text-[11px] text-muted bg-elevated/25"
      >
        <UIcon name="i-lucide-info" class="size-3.5 shrink-0" />
        <span role="status">{{
          syncing ? 'Duke ruajtur ndryshimet…' : 'Hapësira private e biznesit'
        }}</span>
      </div>
    </template>
  </UDashboardPanel>
</template>
