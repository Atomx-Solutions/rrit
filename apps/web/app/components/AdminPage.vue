<script setup lang="ts">
import { adminDashboardKey } from '~/utils/dashboard'

defineProps<{ title: string }>()
const route = useRoute()
const { t, locale, setLocale } = useI18n()
const admin = inject(adminDashboardKey)
if (!admin) throw new Error('AdminPage requires the admin layout')
const { sidebarOpen } = admin

const languageOptions = computed(() => [
  { label: `SQ ${t('admin.settings.albanian')}`, value: 'sq-XK' },
  { label: `EN ${t('admin.settings.english')}`, value: 'en-US' },
])
const languageLabel = computed(() => locale.value === 'en-US'
  ? t('admin.settings.english')
  : t('admin.settings.albanian'))
const languageFlag = computed(() => locale.value === 'en-US' ? 'i-flag-gb-4x3' : 'i-flag-al-4x3')
const language = computed({
  get: () => locale.value,
  set: (value: string) => setLocale(value),
})
</script>
<template>
  <UDashboardPanel
    :id="`admin-${route.path}`"
    :ui="{
      root: 'min-h-full min-w-0 flex flex-col bg-default',
      body: 'flex-none overflow-visible p-0 sm:p-0 gap-0',
    }"
  >
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
          <USelect
            v-model="language"
            :items="languageOptions"
            variant="ghost"
            :aria-label="t('admin.settings.language')"
            class="w-40 sm:w-32"
            :ui="{ base: 'ps-2.5 sm:ps-9' }"
          >
            <template #leading>
              <UIcon name="i-lucide-languages" class="size-5 hidden sm:block" />
            </template>
            <template #default>
              <span class="inline-flex items-center gap-1.5">
                <UIcon :name="languageFlag" class="size-4 sm:hidden" />
                {{ languageLabel }}
              </span>
            </template>
          </USelect>
          <UColorModeButton :aria-label="t('dashboard.changeAppearance')" color="neutral" variant="ghost" />
        </template>
      </UDashboardNavbar>
    </template>
    <template #body>
      <slot />
    </template>
    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </UDashboardPanel>
</template>
