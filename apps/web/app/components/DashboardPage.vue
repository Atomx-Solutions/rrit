<script setup lang="ts">
import { dashboardKey } from '~/utils/dashboard'
import { dashboardToolbarUi } from '~/utils/dashboard-header'

const props = withDefaults(
  defineProps<{
    title: string
    description?: string
    eyebrow?: string
    toolbarBorder?: boolean
    mobileTitle?: string
  }>(),
  { description: undefined, eyebrow: undefined, toolbarBorder: true, mobileTitle: undefined },
)
const route = useRoute()
const chrome = inject(dashboardKey)
if (!chrome) throw new Error('DashboardPage requires the dashboard layout')
const { sidebarOpen, notificationsOpen } = chrome
const { base, storageError, syncing } = useWorkspace()
const { t, locale } = useI18n()
const { watchError } = useFormFeedback()
watchError(storageError, 'error')
const { data: headerUsage } = useHeaderUsage()
// Show settled customer credits in the global header. `spendable` subtracts
// temporary reservations and can rise again when a cheaper AI run settles,
// which makes the balance look like credits were returned during generation.
// The server still uses spendable for entitlement checks.
const credits = computed(() => headerUsage.value?.credits?.remaining)
const spendableCredits = computed(() => headerUsage.value?.credits?.spendable)
// `basis` rather than `flex-1` on the description: the row has to decide to
// wrap before it decides to squeeze. With flex-1 the editor's three actions
// left the description about sixty pixels wide, one word per line and
// overlapping the save status. A wide set of actions now drops to its own line
// and the description keeps the row, while a single button still shares it.
const toolbarUi = computed(() => dashboardToolbarUi(props.toolbarBorder))
let creditTimer: ReturnType<typeof setInterval>
// Coming back to the tab (after the team changed a package, for example)
// reads the balance at once instead of waiting for the next tick.
function refreshWhenVisible() {
  if (document.visibilityState === 'visible') void refreshCreditBalance()
}
onMounted(() => {
  creditTimer = setInterval(() => refreshCreditBalance(), 30_000)
  document.addEventListener('visibilitychange', refreshWhenVisible)
  window.addEventListener('focus', refreshWhenVisible)
})
onBeforeUnmount(() => {
  clearInterval(creditTimer)
  document.removeEventListener('visibilitychange', refreshWhenVisible)
  window.removeEventListener('focus', refreshWhenVisible)
})
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
          right: 'gap-1 sm:gap-1.5',
        }"
      >
        <template v-if="mobileTitle" #title>
          <span class="sm:hidden">{{ mobileTitle }}</span>
          <span class="hidden sm:inline">{{ title }}</span>
        </template>
        <template #leading>
          <UButton
            icon="i-lucide-panel-left"
            color="neutral"
            variant="ghost"
            :aria-label="t('nav.toggle')"
            :aria-expanded="sidebarOpen"
            aria-controls="navigation"
            class="hidden lg:inline-flex"
            @click="sidebarOpen = !sidebarOpen"
          />
          <UButton
            icon="i-lucide-menu"
            color="neutral"
            variant="ghost"
            :aria-label="t('nav.open')"
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
          <!-- On a phone search is at the top of the menu, which leaves the title room. -->
          <UDashboardSearchButton
            :collapsed="true"
            :aria-label="t('nav.searchWorkspace')"
            color="neutral"
            variant="ghost"
            class="hidden sm:inline-flex lg:hidden"
          />
          <!-- On a phone the balance shows only its figure, so the page title
               keeps room; the word is still read out. -->
          <UTooltip :text="t('dashboard.aiBalance')">
            <UButton
              :to="`${base}/billing`"
              color="neutral"
              variant="soft"
              size="sm"
              icon="i-lucide-coins"
              :aria-label="`${credits ?? '—'} ${t('dashboard.credits')}`"
              class="tabular-nums"
            >
              {{ credits ?? '—' }}<span class="hidden sm:inline">&nbsp;{{ t('dashboard.credits') }}</span>
            </UButton>
          </UTooltip>
          <UColorModeButton :aria-label="t('dashboard.changeAppearance')" color="neutral" variant="ghost" />
          <UButton
            icon="i-lucide-bell"
            :aria-label="t('nav.notifications')"
            color="neutral"
            variant="ghost"
            @click="notificationsOpen = true"
          />
        </template>
      </UDashboardNavbar>
      <!-- Below xl the navbar has no room for the page actions. They share the
           description's row rather than taking a band of their own, which on a
           phone cost a third of the height above the content. -->
      <UDashboardToolbar
        v-if="$slots.toolbar || description || $slots.actions"
        :ui="toolbarUi"
      >
        <template #left
          ><slot name="toolbar"
            ><p class="text-xs text-muted leading-relaxed">{{ description }}</p></slot
          ></template
        >
        <template v-if="$slots.actions" #right>
          <!-- On a phone the page actions are compact (smaller type, icons and
               padding) so they take less of the screen; touch keeps them tall
               enough to tap. -->
          <div class="page-actions flex flex-wrap items-center justify-end gap-1.5 xl:hidden">
            <slot name="actions" />
          </div>
        </template>
      </UDashboardToolbar>
    </template>
    <template #body>
      <div class="page dashboard-page-body space-y-4">
        <TrialBanner :key="locale" />
        <PackageExpiryBanner :package-expiry="headerUsage?.packageExpiry" />
        <LowCreditBanner
          :spendable="spendableCredits"
          :threshold="headerUsage?.lowCredit.threshold"
          :has-active-package="headerUsage?.lowCredit.hasActivePackage"
        />
        <slot />
      </div>
    </template>
    <template #footer>
      <div
        class="flex items-center gap-2 border-t border-default px-3 sm:px-4 py-1.5 text-[11px] text-muted bg-elevated/25"
      >
        <UIcon name="i-lucide-info" class="size-3.5 shrink-0" />
        <span role="status">{{ syncing ? t('dashboard.savingStatus') : t('dashboard.savedStatus') }}</span>
      </div>
    </template>
  </UDashboardPanel>
</template>
