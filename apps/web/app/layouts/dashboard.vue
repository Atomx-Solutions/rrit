<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import { navigation } from '~/data/navigation'
import { dashboardKey } from '~/utils/dashboard'
import { authClient } from '~/utils/auth-client'
import { emptyWorkspace } from '~~/shared/utils/empty-workspace'
const { data, base, ready, context, conflict, reload, exportData } = useWorkspace()
// The business settings decide the client app's language. A cookie left by an
// earlier visit must not override what the workspace saved.
const { t, locale: activeLocale, setLocale: applyLocale } = useI18n()
watch(
  () => ready.value && data.value.preferences.locale,
  (saved) => {
    if (saved && saved !== activeLocale.value) applyLocale(saved)
  },
  { immediate: true },
)
const toast = useToast()
const { ask: requestPackage } = useBillingRequest()
async function signOut() {
  const result = await authClient.signOut()
  if (result.error) {
    toast.add({ title: t('dashboard.signOutFailed'), color: 'error' })
    return
  }
  ready.value = false
  context.value = null
  clearNuxtData()
  data.value = emptyWorkspace()
  await navigateTo('/login')
}
const route = useRoute()
// The same snapshot the header already loads for the credit balance, so the
// badge costs no extra request.
const { data: billingSnapshot } = useHeaderUsage()
const pendingProposals = computed(() => billingSnapshot.value?.pendingProposals || 0)
const {
  items: notificationItems,
  unread: unreadCount,
  markRead,
  toggleRead,
  markAllRead,
  remove: removeNotification,
  removeAll,
} = useNotifications()
// Use a new preference key so every existing workspace starts with the compact
// icon rail, then retain the navigation width chosen by that user.
const collapsed = useCookie('rrit-sidebar-collapsed-v2', { default: () => true })
const sidebarOpen = ref(!collapsed.value)
// Tooltips are useful for truncated names on desktop, but touch devices open
// them on tap and obscure the business switcher instead of helping navigation.
const touchInput = ref(false)
let touchInputMedia: MediaQueryList | undefined
function updateTouchInput() {
  touchInput.value = !!touchInputMedia?.matches
}
// A post deleted on Facebook or Instagram stops showing as published within
// a minute or two: Meta sends no notice, so the published posts are checked
// while the workspace is open and on each page change.
const publishedCheckIntervalMs = 90_000
let publishedCheckTimer: ReturnType<typeof setInterval> | undefined
let lastPublishedCheck = 0
async function checkPublishedPosts() {
  if (!ready.value || Date.now() - lastPublishedCheck < 30_000) return
  lastPublishedCheck = Date.now()
  try {
    const result = await $fetch('/api/posts/publication-check', { method: 'POST', body: {}, retry: 0 })
    if (result.removed.length) {
      await reload()
      toast.add({ title: t('content.removedFromNetworkCount', { count: result.removed.length }), color: 'warning' })
    }
  } catch {
    /* Posts stay as they are when the networks cannot be asked. */
  }
}
watch(() => route.path, () => void checkPublishedPosts())
watch(ready, (isReady) => {
  if (isReady) void checkPublishedPosts()
})
onMounted(() => {
  touchInputMedia = window.matchMedia('(hover: none), (pointer: coarse)')
  updateTouchInput()
  touchInputMedia.addEventListener('change', updateTouchInput)
  void checkPublishedPosts()
  publishedCheckTimer = setInterval(() => void checkPublishedPosts(), publishedCheckIntervalMs)
})
onBeforeUnmount(() => {
  touchInputMedia?.removeEventListener('change', updateTouchInput)
  clearInterval(publishedCheckTimer)
})
// A mobile drawer closing must not overwrite the desktop preference.
watch(sidebarOpen, (open) => {
  if (import.meta.client && !window.matchMedia('(max-width: 1023px)').matches) {
    collapsed.value = !open
  }
})
const searchOpen = ref(false)
const notificationsOpen = ref(false)
provide(dashboardKey, { sidebarOpen, notificationsOpen })
const copilotOpen = ref(false)
watch(searchOpen, (open) => {
  if (open && window.matchMedia('(max-width: 1023px)').matches) sidebarOpen.value = false
})
function openHelp() {
  if (window.matchMedia('(max-width: 1023px)').matches) sidebarOpen.value = false
  copilotOpen.value = true
}
const feedbackOpen = ref(false)
function openFeedback() {
  if (window.matchMedia('(max-width: 1023px)').matches) sidebarOpen.value = false
  feedbackOpen.value = true
}
function item(n: (typeof navigation)[number]): NavigationMenuItem {
  return {
    label: t(n.label),
    icon: n.icon,
    to: `${base.value}/${n.path}`,
    // Start loading the next workspace page as soon as the navigation item is
    // hovered/focused, so the click only performs the data request.
    prefetch: true,
    // A page's leave guard runs before the router's beforeEach, so a page
    // asking about unsaved changes would open its dialog under the phone menu.
    // Closing the menu on the tap itself leaves that dialog on top.
    onSelect: () => {
      if (window.matchMedia('(max-width: 1023px)').matches) sidebarOpen.value = false
    },
    active: route.path.includes(`/${n.path}`),
    tooltip: { text: t(n.label) },
    // How many posts there are, matching the count the content list shows. A
    // badge that counted only what awaited approval read as a total and
    // contradicted that list whenever nothing was waiting.
    //
    // Billing counts offers waiting for a decision instead, because an offer
    // expires unanswered if nobody notices it.
    badge:
      n.path === 'content'
        ? data.value.posts.length || undefined
        : n.path === 'billing'
          ? pendingProposals.value || undefined
          : undefined,
  }
}
function items(paths: string[]) {
  return paths
    .map((path) => navigation.find((entry) => entry.path === path))
    .filter((entry): entry is (typeof navigation)[number] => !!entry)
    .map(item)
}
function section(
  label: string,
  icon: string,
  paths: string[],
  defaultOpen = false,
): NavigationMenuItem {
  return {
    label: t(label),
    icon,
    type: 'trigger',
    value: `section-${paths[0]}`,
    active: paths.some((path) => route.path.includes(`/${path}`)),
    defaultOpen,
    popover: true,
    children: items(paths),
  }
}
const menu = computed<NavigationMenuItem[]>(() => [
  item(navigation.find((entry) => entry.path === 'overview')!),
  section(
    'nav.content',
    'i-lucide-panels-top-left',
    ['monthly-planner', 'content', 'calendar', 'templates', 'gallery'],
    true,
  ),
  section('nav.channels', 'i-lucide-store', ['brand', 'social-posts'], true),
])
const footerMenu = computed<NavigationMenuItem[]>(() => [
  section('nav.administration', 'i-lucide-settings', ['billing', 'settings'], true),
])
const businessMenu = computed(() => [
  [{ label: data.value.brand.name, icon: 'i-lucide-check', to: `${base.value}/overview` }],
  [
    { label: t('nav.businessProfile'), icon: 'i-lucide-store', to: `${base.value}/brand` },
    {
      label: t('nav.meta'),
      icon: 'i-lucide-link',
      to: `${base.value}/social-posts`,
    },
  ],
])
const profileMenu = computed(() => [
  [
    { label: data.value.preferences.name, type: 'label' as const },
    { label: t('nav.myProfile'), icon: 'i-lucide-user-round', to: `${base.value}/settings` },
    { label: t('nav.stepHelp'), icon: 'i-lucide-circle-help', onSelect: openHelp },
    { label: t('nav.feedback'), icon: 'i-lucide-message-square-heart', onSelect: openFeedback },
  ],
  [
    {
      label: t('nav.signOut'),
      icon: 'i-lucide-log-out',
      onSelect: signOut,
    },
  ],
])
const commands = computed(() => [
  {
    id: 'pages',
    label: t('nav.whereToGo'),
    items: navigation.map((n) => ({
      label: t(n.label),
      icon: n.icon,
      onSelect: () => {
        searchOpen.value = false
        navigateTo(`${base.value}/${n.path}`)
      },
    })),
  },
  {
    id: 'posts',
    label: t('nav.yourPosts'),
    items: data.value.posts.map((p) => ({
      label: p.title,
      icon: 'i-lucide-file-text',
      onSelect: () => {
        searchOpen.value = false
        navigateTo(`${base.value}/content/${p.id}`)
      },
    })),
  },
])
// Close the phone menu the moment a link is tapped, not once the next page has
// finished loading, so the tap gets an immediate response.
const removeNavigationGuard = useRouter().beforeEach((to, from) => {
  if (
    to.path !== from.path &&
    import.meta.client &&
    window.matchMedia('(max-width: 1023px)').matches
  ) {
    sidebarOpen.value = false
  }
})
onBeforeUnmount(removeNavigationGuard)
</script>
<template>
  <div>
    <ULink to="#main" class="skip-link">{{ t('nav.skipToContent') }}</ULink>
    <UDashboardGroup unit="px" storage-key="rrit-dashboard" class="app-shell studio-shell">
      <USidebar
        id="navigation"
        v-model:open="sidebarOpen"
        collapsible="icon"
        rail
        :menu="{
          title: t('nav.navigation'),
          description: t('nav.navigationDescription'),
          // The phone menu should feel like it follows the tap, not trail it.
          ui: {
            overlay:
              'data-[state=open]:animate-[fade-in_120ms_var(--ease-out)] data-[state=closed]:animate-[fade-out_90ms_var(--ease-out)]',
            content:
              'data-[state=open]:animate-[slide-in-from-left_140ms_var(--ease-out)] data-[state=closed]:animate-[slide-out-to-left_100ms_var(--ease-out)]',
          },
        }"
        :ui="{
          root: '[--sidebar-width:12.5rem] [--sidebar-width-icon:3.25rem]',
          gap: 'duration-120',
          container: 'h-full duration-120',
          inner: 'bg-elevated/25 divide-transparent',
          header: 'h-[52px] min-h-[52px] px-1.5 gap-1',
          body: 'p-2 gap-3',
          footer: 'p-2',
        }"
      >
        <template #header="{ state, close }">
          <UDropdownMenu
            :items="businessMenu"
            :content="{ align: 'start', collisionPadding: 12 }"
            :ui="{ content: 'w-72 max-w-[calc(100vw-1.5rem)]' }"
          >
            <template #item-label="{ item: menuItem }">
              <UTooltip
                v-if="menuItem.label === t('nav.meta')"
                :text="t('nav.meta')"
                :content="{ side: 'bottom', align: 'start', sideOffset: 6, collisionPadding: 8 }"
                :ui="{ content: 'h-auto rounded-md border border-default bg-default px-2.5 py-1.5 text-xs font-medium text-highlighted shadow-md' }"
              >
                <span class="block whitespace-nowrap leading-5">{{ menuItem.label }}</span>
              </UTooltip>
              <span v-else class="block truncate">{{ menuItem.label }}</span>
            </template>
            <UTooltip
              :text="data.brand.name"
              :disabled="touchInput || (state !== 'collapsed' && data.brand.name.length <= 12)"
              :content="{ side: 'bottom', align: 'start', sideOffset: 6 }"
              :ui="{ content: 'h-auto min-h-7 px-2.5 py-1.5 text-sm', text: 'font-medium' }"
            >
              <UButton
                color="neutral"
                variant="ghost"
                :square="state === 'collapsed'"
                :label="state === 'collapsed' ? undefined : data.brand.name"
                :trailing-icon="state === 'collapsed' ? undefined : 'i-lucide-chevrons-up-down'"
                :aria-label="t('nav.businessAria', { name: data.brand.name })"
                class="min-w-0 w-full data-[state=open]:bg-elevated overflow-hidden"
                :ui="{
                  label: 'truncate flex-1 text-left font-semibold',
                  trailingIcon: 'text-dimmed ms-auto',
                }"
              >
                <template #leading
                  ><img src="/f-logo.png" alt="" width="26" height="26" class="shrink-0"
                /></template>
              </UButton>
            </UTooltip>
          </UDropdownMenu>
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            :aria-label="t('nav.close')"
            class="lg:hidden"
            @click="close"
          />
        </template>
        <template #default="{ state }">
          <UDashboardSearchButton
            :collapsed="state === 'collapsed'"
            :label="t('nav.search')"
            :aria-label="t('nav.searchWorkspace')"
            color="neutral"
            variant="outline"
            class="shrink-0"
          />
          <UNavigationMenu
            :key="state"
            :items="menu"
            orientation="vertical"
            :collapsed="state === 'collapsed'"
            tooltip
            popover
            highlight
            :aria-label="t('nav.main')"
            :ui="{
              link: 'min-h-8 pointer-coarse:min-h-10 px-2 rounded-md text-xs after:w-[3px]',
              linkLeadingIcon: 'size-3.5',
            }"
          />
          <UNavigationMenu
            :items="[
              ...footerMenu,
              { label: t('nav.help'), icon: 'i-lucide-circle-help', onSelect: openHelp },
              { label: t('nav.feedback'), icon: 'i-lucide-message-square-heart', onSelect: openFeedback },
            ]"
            orientation="vertical"
            :collapsed="state === 'collapsed'"
            tooltip
            popover
            highlight
            :aria-label="t('nav.settingsHelp')"
            class="mt-auto"
            :ui="{
              link: 'min-h-8 pointer-coarse:min-h-10 px-2 rounded-md text-xs after:w-[3px]',
              linkLeadingIcon: 'size-3.5',
            }"
          />
        </template>
        <template #footer="{ state }">
          <UDropdownMenu
            :items="profileMenu"
            :content="{ align: 'center', side: 'top', collisionPadding: 12 }"
            :ui="{ content: 'w-(--reka-dropdown-menu-trigger-width) min-w-48' }"
          >
            <UButton
              color="neutral"
              variant="ghost"
              :avatar="{ alt: data.preferences.name, size: 'xs' }"
              :label="state === 'collapsed' ? undefined : data.preferences.name"
              :aria-label="t('nav.account')"
              :trailing-icon="state === 'collapsed' ? undefined : 'i-lucide-chevrons-up-down'"
              block
              class="data-[state=open]:bg-elevated overflow-hidden"
              :ui="{ label: 'flex-1 text-left truncate', trailingIcon: 'text-dimmed ms-auto' }"
            />
          </UDropdownMenu>
        </template>
      </USidebar>
      <main id="main" tabindex="-1" class="flex min-w-0 flex-1 overflow-hidden"><slot /></main>
    </UDashboardGroup>
    <UDashboardSearch
      v-model:open="searchOpen"
      :groups="commands"
      :color-mode="false"
      :fuse="{ fuseOptions: { threshold: 0.25, ignoreLocation: true } }"
      :placeholder="t('nav.searchPages')"
    />
    <USlideover
      v-model:open="notificationsOpen"
      :title="t('nav.notifications')"
      :description="t('nav.notificationsDescription')"
      ><template #body>
        <!-- Like a mail inbox: an unread notice is bold with a closed envelope,
             a read one is quiet with an open one. The envelope toggles it,
             the bin removes it; tapping the row opens where it leads. -->
        <div v-if="notificationItems.length" class="space-y-2">
          <div class="flex items-center justify-end gap-1">
            <UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-mail-open" :disabled="!unreadCount" @click="markAllRead">{{ t('nav.markAllRead') }}</UButton>
            <UButton color="error" variant="ghost" size="xs" icon="i-lucide-trash-2" @click="removeAll">{{ t('nav.clearAll') }}</UButton>
          </div>
          <div class="-mx-2 divide-y divide-default">
            <div
              v-for="note in notificationItems"
              :key="note.key"
              class="group flex items-center gap-1 rounded-lg px-2 py-3 hover:bg-elevated/60"
            >
              <ULink
                :to="note.to"
                class="flex min-w-0 flex-1 items-start gap-3"
                @click="markRead(note); note.request && requestPackage(note.request); notificationsOpen = false"
              >
                <span
                  class="flex size-9 shrink-0 items-center justify-center rounded-lg"
                  :class="note.read ? 'bg-elevated text-muted' : {
                    'bg-error/10 text-error': note.tone === 'error',
                    'bg-warning/10 text-warning': note.tone === 'warning',
                    'bg-primary/10 text-primary': note.tone === 'primary',
                    'bg-elevated text-muted': note.tone === 'neutral',
                  }"
                >
                  <UIcon :name="note.icon" class="size-4" />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="flex items-center gap-2 text-sm" :class="note.read ? 'text-muted' : 'font-semibold text-highlighted'">
                    <span v-if="!note.read" class="size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                    {{ note.title }}
                  </span>
                  <span class="mt-0.5 block text-xs text-muted">{{ note.description }}</span>
                </span>
              </ULink>
              <UButton
                :color="note.read ? 'neutral' : 'primary'"
                variant="ghost"
                size="xs"
                :icon="note.read ? 'i-lucide-mail-open' : 'i-lucide-mail'"
                :aria-label="note.read ? t('nav.markUnread') : t('nav.markRead')"
                @click="toggleRead(note)"
              />
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-trash-2"
                class="hover:text-error"
                :aria-label="t('nav.removeNotification')"
                @click="removeNotification(note)"
              />
            </div>
          </div>
        </div>
        <div v-else class="flex flex-col items-center gap-2 py-10 text-center">
          <UIcon name="i-lucide-bell-off" class="size-6 text-muted" />
          <p class="text-sm text-muted">{{ t('nav.noNotifications') }}</p>
        </div>
      </template
      ></USlideover
    >
    <USlideover
      v-model:open="copilotOpen"
      :title="t('nav.copilotTitle')"
      :description="t('nav.copilotDescription')"
      ><template #body><LazyCopilotPanel @navigate="copilotOpen = false" /></template
    ></USlideover>
    <LazyFeedbackForm v-model:open="feedbackOpen" />
    <UModal
      :open="conflict"
      :dismissible="false"
      :title="t('nav.conflictTitle')"
      :description="t('nav.conflictDescription')"
      ><template #body
        ><div class="flex flex-wrap gap-3">
          <UButton color="neutral" variant="outline" @click="exportData"
            >{{ t('nav.exportCopy') }}</UButton
          ><UButton variant="outline" @click="reload">{{ t('nav.loadLatest') }}</UButton>
        </div></template
      ></UModal
    >
  </div>
</template>
