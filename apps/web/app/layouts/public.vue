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
        ><div class="marketing-header-desktop-tools">
          <UColorModeButton
            :aria-label="t('public.changeAppearance')"
            color="neutral"
            variant="ghost"
            class="marketing-theme-toggle"
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
            class="marketing-header-action rounded-lg"
            >{{ canRegister ? trialLabel : t('public.contactUs') }}</UButton
          >
        </div></template
      ><template #body
        ><div class="marketing-mobile-tools">
          <UColorModeButton
            :aria-label="t('public.changeAppearance')"
            color="neutral"
            variant="ghost"
            class="marketing-theme-toggle"
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
            class="marketing-header-action marketing-mobile-action rounded-lg"
            >{{ canRegister ? trialLabel : t('public.contactUs') }}</UButton
          >
        </div><UNavigationMenu
          :items="[...links, { label: t('public.loginAccount'), to: '/login' }]"
          orientation="vertical" /></template></UHeader
    ><UMain id="main"><slot /></UMain
    ><UFooter
      class="marketing-footer"
      :ui="{
        container: 'max-w-[1220px] px-6 sm:px-10 py-6',
        left: 'text-xs text-muted',
        right: 'text-xs text-muted',
      }"
    >
      <template #top>
        <UContainer class="marketing-footer-content">
          <div class="marketing-footer-top">
            <div class="marketing-footer-intro">
              <p>{{ t('public.moreTime') }}<br /><span>{{ t('public.forYourBusiness') }}</span></p>
              <span>{{ t('public.youWithBusiness') }}</span>
            </div>
            <nav :aria-label="t('public.exploreRrit')">
              <p>{{ t('public.explore') }}</p>
              <ULink to="/#perse">{{ t('public.howItWorks') }}</ULink><ULink to="/pricing">{{ t('public.plans') }}</ULink
              ><ULink to="/#pyetje">{{ t('public.faq') }}</ULink>
            </nav>
            <nav :aria-label="t('public.accountAndHelp')">
              <p>{{ t('public.getStarted') }}</p>
              <ULink v-if="canRegister" to="/signup">{{ t('public.createAccount') }}</ULink
              ><ULink to="/login">{{ t('public.loginAccount') }}</ULink><ULink to="/help">{{ t('public.helpCenter') }}</ULink>
            </nav>
          </div>
          <div class="marketing-footer-signoff">
            <BrandLogo class="marketing-footer-signature" />
            <p>
              {{ t('public.fromIdea') }}<br />{{ t('public.nextPost') }}<UIcon
                name="i-lucide-arrow-up-right"
                aria-hidden="true"
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

<style scoped>
.marketing-theme-toggle {
  min-width: 36px;
  min-height: 36px;
}
.marketing-header-desktop-tools {
  display: flex;
  align-items: center;
  gap: 8px;
}
.marketing-mobile-tools {
  display: none;
}
@media (max-width: 639px) {
  .marketing-header-desktop-tools {
    display: none;
  }
  .marketing-mobile-tools {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 12px;
    padding: 4px 0 18px;
    margin-bottom: 16px;
    border-bottom: 1px solid var(--ui-border);
  }
  .marketing-mobile-action {
    grid-column: 1 / -1;
    width: 100%;
  }
  .marketing-mobile-tools :deep([data-slot='base']) {
    justify-self: end;
  }
}
@media (max-width: 379px) {
  .marketing-header :deep([data-slot='container']) {
    padding-inline: 16px;
  }
  .marketing-header-action {
    font-size: 11px;
    padding-inline: 8px;
    white-space: nowrap;
  }
  .marketing-header-action :deep(.iconify) {
    display: none;
  }
}
.marketing-footer {
  background: var(--rrit-color-marketing-footer);
  color: var(--rrit-color-marketing-text);
  --ui-text-muted: var(--rrit-color-marketing-footer-muted);
  padding-top: 56px;
}
:global(.dark .marketing-footer) {
  background: var(--rrit-color-marketing-footer);
  color: var(--rrit-color-marketing-text);
  --ui-text-muted: var(--rrit-color-marketing-footer-muted);
}
.marketing-footer-content {
  max-width: 1220px;
  padding-inline: 40px;
}
.marketing-footer-top {
  display: grid;
  grid-template-columns: 1.6fr 1fr 1fr;
  gap: 55px;
}
.marketing-footer-intro > p {
  font-size: 27px;
  line-height: 1.25;
  letter-spacing: -1px;
  font-weight: 500;
}
.marketing-footer-intro > p span {
  color: var(--ui-primary);
}
.marketing-footer-intro > span {
  display: block;
  font-size: 12px;
  color: var(--ui-text-muted);
  margin-top: 18px;
}
.marketing-footer-top nav {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 14px;
  font-size: 13px;
}
.marketing-footer-top nav > p {
  margin-bottom: 8px;
  font-size: 9px;
  letter-spacing: 1.1px;
  color: var(--ui-text-muted);
}
.marketing-footer-top nav a {
  padding-block: 3px;
}
.marketing-footer-top nav a:hover {
  color: var(--ui-primary);
}
.marketing-footer-signoff {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 35px;
  padding-block: 40px 16px;
}
.marketing-footer-signature {
  width: 102px;
}
.marketing-footer-signature :deep(img) {
  width: 100%;
  height: auto;
}
.marketing-footer-signoff > p {
  font-size: 12px;
  line-height: 1.7;
  color: var(--ui-text-muted);
}
.marketing-footer-signoff .iconify {
  display: inline-block;
  width: 18px;
  height: 18px;
  margin-left: 12px;
  vertical-align: middle;
  color: var(--ui-primary);
}
@media (max-width: 639px) {
  .marketing-footer {
    padding-top: 40px;
  }
  .marketing-footer-content {
    padding-inline: 24px;
  }
  .marketing-footer-top {
    grid-template-columns: 1fr 1fr;
    gap: 34px 20px;
  }
  .marketing-footer-intro {
    grid-column: 1 / -1;
  }
  .marketing-footer-intro > p {
    font-size: 26px;
  }
  .marketing-footer-top nav {
    font-size: 12px;
    gap: 12px;
  }
  .marketing-footer-signoff {
    padding-block: 32px 12px;
    gap: 20px;
  }
  .marketing-footer-signature {
    width: 84px;
  }
  .marketing-footer-signoff > p {
    font-size: 11px;
    text-align: right;
  }
  .marketing-footer-signoff .iconify {
    display: none;
  }
}
</style>
