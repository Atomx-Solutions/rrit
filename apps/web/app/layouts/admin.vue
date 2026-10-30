<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import { adminAuthClient } from '~/utils/auth-client'
import { adminDashboardKey } from '~/utils/dashboard'

const { t, setLocale } = useI18n()
await setLocale('en-US')
const toast = useToast()
const route = useRoute()
const { data: admin } = await useFetch('/api/admin/me', { key: 'admin-me', lazy: true })
const { data: packageRequestSummary, refresh: refreshPackageRequestSummary } = await useFetch<{ open_count: number }>(
  '/api/admin/package-requests',
  { key: 'admin-package-request-count', lazy: true },
)

const { data: feedbackSummary, refresh: refreshFeedbackSummary } = await useFetch<{
  feedback: { created_at: string }[]
}>('/api/admin/feedback', { key: 'admin-feedback-count', lazy: true })

const openPackageRequestCount = computed(() => packageRequestSummary.value?.open_count || 0)
let packageRequestCountTimer: ReturnType<typeof setInterval> | undefined

// Feedback has no status, so "new" means arrived since this browser last
// opened the feedback page.
const feedbackSeenKey = 'rrit-admin-feedback-seen-at'
const feedbackSeenAt = ref('')
const newFeedbackCount = computed(() =>
  (feedbackSummary.value?.feedback || []).filter(entry => entry.created_at > feedbackSeenAt.value).length,
)
function markFeedbackSeen() {
  const latest = feedbackSummary.value?.feedback[0]?.created_at
  if (!latest || latest <= feedbackSeenAt.value) return
  feedbackSeenAt.value = latest
  try {
    localStorage.setItem(feedbackSeenKey, latest)
  } catch {
    // Storage may be blocked; the badge then only lasts for this visit.
  }
}
const onFeedbackPage = computed(() => route.path.startsWith('/admin/feedback'))
watch([feedbackSummary, onFeedbackPage], () => {
  if (onFeedbackPage.value) markFeedbackSeen()
})
watch(newFeedbackCount, (count, previous) => {
  if (count > previous && !onFeedbackPage.value)
    toast.add({
      title: t('admin.feedback.newNotification'),
      description: t('admin.feedback.newNotificationDescription', { count }),
      color: 'info',
      actions: [{ label: t('admin.feedback.open'), to: '/admin/feedback' }],
    })
})

async function refreshPackageRequestCount() {
  if (document.visibilityState !== 'visible') return
  await Promise.all([refreshPackageRequestSummary(), refreshFeedbackSummary()])
}

onMounted(() => {
  // Without a stored mark everything already here counts as seen, so the
  // first visit does not announce the whole history.
  let stored: string | null = null
  try {
    stored = localStorage.getItem(feedbackSeenKey)
  } catch {
    // Storage may be blocked; the mark then only lasts for this visit.
  }
  feedbackSeenAt.value = stored || feedbackSummary.value?.feedback[0]?.created_at || new Date().toISOString()
  if (onFeedbackPage.value) markFeedbackSeen()
  packageRequestCountTimer = setInterval(refreshPackageRequestCount, 5000)
  window.addEventListener('focus', refreshPackageRequestCount)
})

onBeforeUnmount(() => {
  if (packageRequestCountTimer) clearInterval(packageRequestCountTimer)
  window.removeEventListener('focus', refreshPackageRequestCount)
})

// Same sidebar behavior as the customer dashboard, with its own preference.
const collapsed = useCookie('rrit-admin-sidebar-collapsed', { default: () => false })
const sidebarOpen = ref(!collapsed.value)
// A mobile drawer closing must not overwrite the desktop preference.
watch(sidebarOpen, (open) => {
  if (import.meta.client && !window.matchMedia('(max-width: 1023px)').matches)
    collapsed.value = !open
})
watch(
  () => route.path,
  () => {
    if (import.meta.client && window.matchMedia('(max-width: 1023px)').matches)
      sidebarOpen.value = false
  },
)
provide(adminDashboardKey, { sidebarOpen })

// "/admin/" and "/admin" are the same page.
const currentPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const menu = computed<NavigationMenuItem[]>(() =>
  [
    { to: '/admin', label: t('admin.nav.overview'), icon: 'i-lucide-layout-dashboard' },
    { to: '/admin/organizations', label: t('admin.nav.organizations'), icon: 'i-lucide-building-2' },
    { to: '/admin/invitations', label: t('admin.nav.invitations'), icon: 'i-lucide-user-plus' },
    {
      to: '/admin/package-requests',
      label: t('admin.nav.packageRequests'),
      icon: 'i-lucide-inbox',
      badge: openPackageRequestCount.value || undefined,
    },
    {
      to: '/admin/feedback',
      label: t('admin.nav.feedback'),
      icon: 'i-lucide-message-square-heart',
      // Feedback is deleted once handled, so every entry still here is open,
      // the same way the requests badge counts open requests.
      badge: feedbackSummary.value?.feedback.length || undefined,
    },
    { to: '/admin/users', label: t('admin.nav.users'), icon: 'i-lucide-users' },
    { to: '/admin/plans', label: t('admin.nav.billingSettings'), icon: 'i-lucide-receipt-text' },
    { to: '/admin/subscriptions', label: t('admin.nav.subscriptions'), icon: 'i-lucide-repeat' },
    { to: '/admin/billing', label: t('admin.nav.billing'), icon: 'i-lucide-receipt-text' },
    { to: '/admin/ai', label: t('admin.nav.ai'), icon: 'i-lucide-cpu' },
    { to: '/admin/audit', label: t('admin.nav.audit'), icon: 'i-lucide-scroll-text' },
    { to: '/admin/settings', label: t('admin.nav.settings'), icon: 'i-lucide-settings' },
  ].map(link => ({
    ...link,
    tooltip: { text: link.label },
    // Overview is active only on /admin itself, the others on their subpages too.
    active: link.to === '/admin' ? currentPath.value === '/admin' : currentPath.value.startsWith(link.to),
  })),
)

const signingOut = ref(false)
async function signOut() {
  signingOut.value = true
  const result = await adminAuthClient.signOut()
  signingOut.value = false
  if (result.error) {
    toast.add({ title: t('admin.signOutFailed'), color: 'error' })
    return
  }
  clearNuxtData()
  useState<number>('superadmin-verified-at').value = 0
  await navigateTo('/admin/login', { replace: true })
}
const profileMenu = computed(() => [
  [{ label: admin.value?.email || '', type: 'label' as const }],
  [{ label: t('admin.signOut'), icon: 'i-lucide-log-out', onSelect: signOut }],
])
</script>
<template>
  <UDashboardGroup unit="px" storage-key="rrit-admin" class="app-shell studio-shell">
    <USidebar
      id="admin-navigation"
      v-model:open="sidebarOpen"
      collapsible="icon"
      rail
      :menu="{ title: t('admin.nav.label') }"
      :ui="{
        root: '[--sidebar-width:15rem] [--sidebar-width-icon:3.25rem]',
        container: 'h-full',
        inner: 'bg-elevated/25 divide-transparent',
        header: 'h-[52px] min-h-[52px] px-1.5 gap-1',
        body: 'p-2 gap-3',
        footer: 'p-2',
      }"
    >
      <template #header="{ state, close }">
        <UButton
          to="/admin"
          color="neutral"
          variant="ghost"
          :square="state === 'collapsed'"
          :label="state === 'collapsed' ? undefined : 'Framic Admin'"
          :avatar="{ src: '/f-logo.png', alt: '', size: 'xs' }"
          class="min-w-0 w-full overflow-hidden"
          :ui="{ label: 'truncate flex-1 text-left font-semibold' }"
        />
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
        <UNavigationMenu
          :key="state"
          :items="menu"
          orientation="vertical"
          :collapsed="state === 'collapsed'"
          tooltip
          :aria-label="t('admin.nav.label')"
          :ui="{
            link: 'min-h-8 pointer-coarse:min-h-10 px-2 rounded-md text-xs after:absolute after:-start-1.5 after:inset-y-0.5 after:hidden after:w-[3px] after:rounded-full data-[active]:after:block data-[active]:after:bg-primary',
            linkLeadingIcon: 'size-3.5',
            linkTrailing: 'inline-flex items-center justify-center size-[18px] rounded-full ring ring-default text-[10px] font-semibold leading-none text-default',
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
            :avatar="{ alt: admin?.email, size: 'xs' }"
            :label="state === 'collapsed' ? undefined : admin?.email"
            :loading="signingOut"
            :aria-label="t('nav.account')"
            :trailing-icon="state === 'collapsed' ? undefined : 'i-lucide-chevrons-up-down'"
            block
            data-testid="admin-email"
            class="data-[state=open]:bg-elevated overflow-hidden"
            :ui="{ label: 'flex-1 text-left truncate', trailingIcon: 'text-dimmed ms-auto' }"
          />
        </UDropdownMenu>
      </template>
    </USidebar>
    <!-- Same as the customer layout: a fixed-height main lets the panel body scroll. -->
    <main id="main" tabindex="-1" class="flex min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto"><slot /></main>
  </UDashboardGroup>
</template>
