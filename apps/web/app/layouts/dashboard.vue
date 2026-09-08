<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import { navigation } from '~/data/navigation'
import { dashboardKey } from '~/utils/dashboard'
import { authClient } from '~/utils/auth-client'
import { emptyWorkspace } from '~~/shared/utils/empty-workspace'
const { data, base, ready, context, conflict, reload, exportData } = useWorkspace()
const toast = useToast()
async function signOut() {
  const result = await authClient.signOut()
  if (result.error) {
    toast.add({ title: 'Dalja dështoi. Provo sërish.', color: 'error' })
    return
  }
  ready.value = false
  context.value = null
  clearNuxtData()
  data.value = emptyWorkspace()
  await navigateTo('/login')
}
const route = useRoute()
const collapsed = useCookie('rrit-sidebar-collapsed', { default: () => false })
const sidebarOpen = ref(!collapsed.value)
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
function item(n: (typeof navigation)[number]): NavigationMenuItem {
  return {
    label: n.label,
    icon: n.icon,
    to: `${base.value}/${n.path}`,
    active: route.path.includes(`/${n.path}`),
    tooltip: { text: n.label },
    badge:
      n.path === 'content'
        ? data.value.posts.filter((p) => p.status === 'review').length
        : undefined,
  }
}
const menu = computed<NavigationMenuItem[][]>(() => [
  [
    ...navigation
      .filter((n) => ['overview', 'content', 'calendar', 'gallery'].includes(n.path))
      .map(item),
  ],
  [...navigation.filter((n) => ['social-posts', 'brand'].includes(n.path)).map(item)],
])
const footerMenu = computed<NavigationMenuItem[]>(() =>
  navigation.filter((n) => ['billing', 'settings'].includes(n.path)).map(item),
)
const businessMenu = computed(() => [
  [{ label: data.value.brand.name, icon: 'i-lucide-check', to: `${base.value}/overview` }],
  [
    { label: 'Profili i biznesit', icon: 'i-lucide-store', to: `${base.value}/brand` },
    { label: 'Facebook dhe Instagram', icon: 'i-lucide-link', to: `${base.value}/social-posts` },
  ],
])
const profileMenu = computed(() => [
  [
    { label: data.value.preferences.name, type: 'label' as const },
    { label: 'Profili im', icon: 'i-lucide-user-round', to: `${base.value}/settings` },
    { label: 'Ndihmë hap pas hapi', icon: 'i-lucide-circle-help', onSelect: openHelp },
  ],
  [
    {
      label: 'Dil nga llogaria',
      icon: 'i-lucide-log-out',
      onSelect: signOut,
    },
  ],
])
const commands = computed(() => [
  {
    id: 'pages',
    label: 'Ku dëshiron të shkosh?',
    items: navigation.map((n) => ({
      label: n.label,
      icon: n.icon,
      onSelect: () => {
        searchOpen.value = false
        navigateTo(`${base.value}/${n.path}`)
      },
    })),
  },
  {
    id: 'posts',
    label: 'Postimet e tua',
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
watch(
  () => route.path,
  () => {
    if (import.meta.client && window.matchMedia('(max-width: 1023px)').matches) {
      sidebarOpen.value = false
    }
  },
)
</script>
<template>
  <div>
    <ULink to="#main" class="skip-link">Kalo te përmbajtja</ULink>
    <UDashboardGroup unit="px" storage-key="rrit-dashboard" class="app-shell studio-shell">
      <USidebar
        id="navigation"
        v-model:open="sidebarOpen"
        collapsible="icon"
        rail
        :menu="{ title: 'Navigimi', description: 'Postimet dhe cilësimet e biznesit tënd.' }"
        :ui="{
          root: '[--sidebar-width:15rem] [--sidebar-width-icon:4rem]',
          container: 'h-full',
          inner: 'bg-elevated/25 divide-transparent',
          header: 'h-16 min-h-16 px-3 gap-2',
          body: 'p-3 gap-5',
          footer: 'p-3',
        }"
      >
        <template #header="{ state, close }">
          <UDropdownMenu
            :items="businessMenu"
            :content="{ align: 'start', collisionPadding: 12 }"
            :ui="{ content: 'w-(--reka-dropdown-menu-trigger-width) min-w-48' }"
          >
            <UButton
              color="neutral"
              variant="ghost"
              :square="state === 'collapsed'"
              :label="state === 'collapsed' ? undefined : data.brand.name"
              :trailing-icon="state === 'collapsed' ? undefined : 'i-lucide-chevrons-up-down'"
              :aria-label="`Biznesi: ${data.brand.name}`"
              class="min-w-0 w-full data-[state=open]:bg-elevated overflow-hidden"
              :ui="{
                label: 'truncate flex-1 text-left font-semibold',
                trailingIcon: 'text-dimmed ms-auto',
              }"
            >
              <template #leading
                ><img src="/favicon.svg" alt="" width="26" height="26" class="shrink-0"
              /></template>
            </UButton>
          </UDropdownMenu>
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            aria-label="Mbyll navigimin"
            class="lg:hidden"
            @click="close"
          />
        </template>
        <template #default="{ state }">
          <UDashboardSearchButton
            :collapsed="state === 'collapsed'"
            label="Kërko..."
            aria-label="Kërko në hapësirë"
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
            aria-label="Navigimi kryesor"
            :ui="{
              link: 'min-h-9 pointer-coarse:min-h-11 px-2.5 rounded-md',
              linkLeadingIcon: 'size-[18px]',
            }"
          />
          <UNavigationMenu
            :items="[
              ...footerMenu,
              { label: 'Ndihmë', icon: 'i-lucide-circle-help', onSelect: openHelp },
            ]"
            orientation="vertical"
            :collapsed="state === 'collapsed'"
            tooltip
            aria-label="Cilësime dhe ndihmë"
            class="mt-auto"
            :ui="{
              link: 'min-h-9 pointer-coarse:min-h-11 px-2.5 rounded-md',
              linkLeadingIcon: 'size-[18px]',
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
              aria-label="Llogaria ime"
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
      placeholder="Kërko faqe ose përmbajtje..."
    />
    <USlideover
      v-model:open="notificationsOpen"
      title="Njoftimet"
      description="Çfarë kërkon vëmendjen tënde."
      ><template #body
        ><div class="space-y-5">
          <UAlert
            title="Postime për miratim"
            :description="`${data.posts.filter((p) => p.status === 'review').length} postime presin mendimin tënd.`"
            icon="i-lucide-file-check"
          /><UButton
            variant="outline"
            :to="`${base}/content?status=review`"
            @click="notificationsOpen = false"
            >Shiko postimet</UButton
          ><USeparator /><UAlert
            color="warning"
            title="Facebook dhe Instagram"
            description="Kontrollo autorizimin, skadimin dhe postimet e importuara nga Meta."
          /><UButton
            :to="`${base}/social-posts`"
            color="neutral"
            variant="outline"
            @click="notificationsOpen = false"
            >Shiko lidhjet</UButton
          ><UButton
            :to="`${base}/settings?tab=notifications`"
            variant="link"
            @click="notificationsOpen = false"
            >Cilësimet e njoftimeve</UButton
          >
        </div></template
      ></USlideover
    >
    <USlideover
      v-model:open="copilotOpen"
      title="Si mund të të ndihmoj?"
      description="Zgjidh një hap dhe vazhdo me udhëzim."
      ><template #body><LazyCopilotPanel @navigate="copilotOpen = false" /></template
    ></USlideover>
    <UModal
      :open="conflict"
      :dismissible="false"
      title="Ka ndryshime nga një skedë tjetër"
      description="Për të mos humbur punën, shkarko kopjen tënde ose ngarko ndryshimet e fundit."
      ><template #body
        ><div class="flex flex-wrap gap-3">
          <UButton color="neutral" variant="outline" @click="exportData"
            >Eksporto kopjen time</UButton
          ><UButton variant="outline" @click="reload">Ngarko versionin e fundit</UButton>
        </div></template
      ></UModal
    >
  </div>
</template>
