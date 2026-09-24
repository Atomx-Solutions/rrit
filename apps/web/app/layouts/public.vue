<script setup lang="ts">
const route = useRoute()
const { t, locale, setLocale } = useI18n()
const languageOptions = computed(() => [
  { label: `SQ ${t('public.albanian')}`, value: 'sq-XK' },
  { label: `EN ${t('public.english')}`, value: 'en-US' },
])
const languageLabel = computed(() => locale.value === 'en-US' ? t('public.english') : t('public.albanian'))
const languageFlag = computed(() => locale.value === 'en-US' ? 'i-flag-gb-4x3' : 'i-flag-al-4x3')
const language = computed({
  get: () => locale.value,
  set: (value: string) => setLocale(value),
})
const links = computed(() => [
  {
    label: t('public.whyRrit'),
    to: '/#perse',
    active: route.path === '/' && route.hash === '#perse',
  },
  {
    label: t('public.prices'),
    to: route.path === '/' ? '/#cmimet' : '/pricing',
    active: route.path === '/pricing' || (route.path === '/' && route.hash === '#cmimet'),
  },
  {
    label: t('public.faq'),
    to: '/#pyetje',
    active: route.path === '/' && route.hash === '#pyetje',
  },
])
const legal = [
  { label: t('public.privacy'), to: '/privacy' },
  { label: t('public.terms'), to: '/terms' },
]
const { trialLabel, canRegister } = useLandingOffer()
const year = new Date().getFullYear()
</script>
<template>
  <div class="marketing">
    <ULink to="#main" class="skip-link">{{ t('public.skipToContent') }}</ULink
    ><UHeader
      class="marketing-header"
      title="Rrit"
      :menu="{ fullscreen: false }"
      :ui="{
        root: 'bg-default/95 backdrop-blur border-default',
        container: 'max-w-[1220px] h-20 px-6 sm:px-10',
      }"
      ><template #left><BrandLogo /></template><UNavigationMenu :items="links" /><template #right
        ><div class="hidden items-center gap-2 sm:flex">
          <UColorModeButton
            :aria-label="t('public.changeAppearance')"
            color="neutral"
            variant="ghost"
            class="min-h-9 min-w-9"
          /><USelect
            v-model="language"
            :items="languageOptions"
            variant="ghost"
            :aria-label="t('public.language')"
            class="w-40 sm:w-32"
            :ui="{ base: 'ps-2.5 sm:ps-9' }"
          >
            <template #leading><UIcon name="i-lucide-languages" class="size-5 hidden sm:block" /></template>
            <template #default>
              <span class="inline-flex items-center gap-1.5">
                <UIcon :name="languageFlag" class="size-4 sm:hidden" />
                {{ languageLabel }}
              </span>
            </template>
          </USelect><UButton to="/login" variant="ghost" color="neutral">{{ t('public.login') }}</UButton
          ><UButton
            :to="canRegister ? '/signup' : '/help'"
            trailing-icon="i-lucide-arrow-up-right"
            size="sm"
            class="rounded-lg whitespace-nowrap max-[379px]:px-2 max-[379px]:text-[11px]"
            >{{ canRegister ? trialLabel : t('public.contactUs') }}</UButton
          >
        </div></template
      ><template #body
        ><div class="grid grid-cols-[auto_1fr] items-center gap-3 border-b border-default pb-[18px] mb-4 sm:hidden">
          <UColorModeButton
            :aria-label="t('public.changeAppearance')"
            color="neutral"
            variant="ghost"
            class="min-h-9 min-w-9"
          /><USelect
            v-model="language"
            :items="languageOptions"
            variant="ghost"
            :aria-label="t('public.language')"
            class="w-40 sm:w-32"
            :ui="{ base: 'ps-2.5 sm:ps-9' }"
          >
            <template #leading><UIcon name="i-lucide-languages" class="size-5 hidden sm:block" /></template>
            <template #default>
              <span class="inline-flex items-center gap-1.5">
                <UIcon :name="languageFlag" class="size-4 sm:hidden" />
                {{ languageLabel }}
              </span>
            </template>
          </USelect><UButton
            :to="canRegister ? '/signup' : '/help'"
            trailing-icon="i-lucide-arrow-up-right"
            size="lg"
            block
            class="col-span-2 w-full rounded-lg"
            >{{ canRegister ? trialLabel : t('public.contactUs') }}</UButton
          >
        </div><UNavigationMenu
          :items="[...links, { label: t('public.loginAccount'), to: '/login' }]"
          orientation="vertical" /></template></UHeader
    ><UMain id="main"><slot /></UMain
    ><UFooter
      class="bg-[var(--rrit-color-marketing-footer)] pt-14 text-[var(--rrit-color-marketing-text)] [--ui-text-muted:var(--rrit-color-marketing-footer-muted)] max-sm:pt-10"
      :ui="{
        container: 'max-w-[1220px] px-6 sm:px-10 py-6',
        left: 'text-xs text-muted',
        right: 'text-xs text-muted',
      }"
    >
      <template #top>
        <UContainer class="max-w-[1220px] px-10 max-sm:px-6">
          <div class="grid grid-cols-[1.6fr_1fr_1fr] gap-[55px] max-sm:grid-cols-2 max-sm:gap-x-5 max-sm:gap-y-[34px]">
            <div class="max-sm:col-span-2">
              <p class="text-[27px] font-medium leading-[1.25] tracking-[-1px] max-sm:text-[26px]">{{ t('public.moreTime') }}<br /><span class="text-primary">{{ t('public.forYourBusiness') }}</span></p>
              <span class="mt-[18px] block text-xs text-muted">{{ t('public.youWithBusiness') }}</span>
            </div>
            <nav class="flex flex-col items-start gap-[14px] text-[13px] max-sm:gap-3 max-sm:text-xs" :aria-label="t('public.exploreRrit')">
              <p class="mb-2 text-[9px] tracking-[1.1px] text-muted">{{ t('public.explore') }}</p>
              <ULink class="py-0.5 hover:text-primary" to="/#perse">{{ t('public.howItWorks') }}</ULink><ULink class="py-0.5 hover:text-primary" to="/pricing">{{ t('public.plans') }}</ULink
              ><ULink class="py-0.5 hover:text-primary" to="/#pyetje">{{ t('public.faq') }}</ULink>
            </nav>
            <nav class="flex flex-col items-start gap-[14px] text-[13px] max-sm:gap-3 max-sm:text-xs" :aria-label="t('public.accountAndHelp')">
              <p class="mb-2 text-[9px] tracking-[1.1px] text-muted">{{ t('public.getStarted') }}</p>
              <ULink v-if="canRegister" class="py-0.5 hover:text-primary" to="/signup">{{ t('public.createAccount') }}</ULink
              ><ULink class="py-0.5 hover:text-primary" to="/login">{{ t('public.loginAccount') }}</ULink><ULink class="py-0.5 hover:text-primary" to="/help">{{ t('public.helpCenter') }}</ULink>
            </nav>
          </div>
          <div class="flex items-center justify-between gap-[35px] py-10 pb-4 max-sm:gap-5 max-sm:py-8 max-sm:pb-3">
            <BrandLogo class="w-[102px] max-sm:w-[84px]" />
            <p class="text-xs leading-[1.7] text-muted max-sm:text-[11px] max-sm:text-right">
              {{ t('public.fromIdea') }}<br />{{ t('public.nextPost') }}<UIcon
                name="i-lucide-arrow-up-right"
                aria-hidden="true"
                class="ml-3 inline-block size-[18px] align-middle text-primary max-sm:hidden"
              />
            </p>
          </div>
        </UContainer>
      </template>
      <template #left>© {{ year }} Rrit</template>
      <UNavigationMenu :items="legal" />
      <template #right>{{ t('public.forKosovoBusinesses') }}</template>
    </UFooter>
  </div>
</template>
