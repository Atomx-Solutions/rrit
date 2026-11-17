<script setup lang="ts">
const route = useRoute()
const { t, locale, setLocale } = useI18n()
// The public landing experience is Swiss German by default for this market;
// a visitor who picked another language keeps it while browsing.
const requestUrl = useRequestURL()
const canonicalUrl = computed(() => `${requestUrl.origin}${requestUrl.pathname}`)
useHead({
  link: [{ rel: 'canonical', href: canonicalUrl }],
  meta: [{ property: 'og:url', content: canonicalUrl }],
})
const publicLanguages = [
  { value: 'de-CH', code: 'DE-CH', key: 'public.german', flag: 'i-flag-de-4x3' },
  { value: 'fr-CH', code: 'FR-CH', key: 'public.french', flag: 'i-flag-fr-4x3' },
  { value: 'it-CH', code: 'IT-CH', key: 'public.italian', flag: 'i-flag-it-4x3' },
  { value: 'en-US', code: 'EN', key: 'public.english', flag: 'i-flag-gb-4x3' },
  { value: 'tr-TR', code: 'TR', key: 'public.turkish', flag: 'i-flag-tr-4x3' },
  { value: 'sq-XK', code: 'SQ', key: 'public.albanian', flag: 'i-flag-al-4x3' },
] as const
const colorMode = useColorMode()
const appearanceModes = [
  { value: 'light', key: 'public.lightMode', icon: 'i-lucide-sun' },
  { value: 'dark', key: 'public.darkMode', icon: 'i-lucide-moon' },
] as const
const languageOptions = computed(() =>
  publicLanguages.map(item => ({ label: `${item.code} ${t(item.key)}`, value: item.value, icon: item.flag })))
const activeLanguage = computed(() =>
  publicLanguages.find(item => item.value === locale.value) ?? publicLanguages[0])
const languageLabel = computed(() => t(activeLanguage.value.key))
const languageFlag = computed(() => activeLanguage.value.flag)
const language = computed({
  get: () => locale.value,
  set: (value: string) => setLocale(value),
})
const sections = [
  { id: 'why-framic', key: 'public.whyFramic' },
  { id: 'pricing', key: 'landing.requestOffer' },
  { id: 'faq', key: 'public.faq' },
] as const
const menuOpen = ref(false)
// The burger only animates once the menu has been used, not on first paint.
const menuUsed = ref(false)
watch(menuOpen, () => (menuUsed.value = true))
// The section currently under the sticky header, tracked while the visitor scrolls the landing page.
const activeSection = ref<string | null>(null)
const headerOffset = () => document.querySelector<HTMLElement>('.marketing-header')?.offsetHeight ?? 0
function updateActiveSection() {
  if (route.path !== '/') return (activeSection.value = null)
  const line = headerOffset() + window.innerHeight / 3
  let current: string | null = null
  for (const { id } of sections) {
    const el = document.getElementById(id)
    if (el && el.getBoundingClientRect().top <= line) current = id
  }
  activeSection.value = current
}
const scrollBehavior = (): ScrollBehavior =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
// The menu locks body scroll while open; close it and wait until the lock is released.
async function closeMenuAndUnlockScroll() {
  menuOpen.value = false
  await nextTick()
  const deadline = performance.now() + 1000
  while (getComputedStyle(document.body).overflow === 'hidden' && performance.now() < deadline)
    await new Promise(resolve => requestAnimationFrame(resolve))
  await new Promise(resolve => requestAnimationFrame(resolve))
}
// On the landing page the logo link points at the current route, so the router
// would not move; scroll back to the top instead.
async function goToTop(event: Event) {
  if (route.path !== '/') return
  event.preventDefault()
  await closeMenuAndUnlockScroll()
  window.scrollTo({ top: 0, behavior: scrollBehavior() })
  history.replaceState(history.state, '', route.path)
  activeSection.value = null
}
async function goToSection(id: string, event?: Event) {
  if (route.path !== '/') return
  const el = document.getElementById(id)
  if (!el) return
  event?.preventDefault()
  await closeMenuAndUnlockScroll()
  const behavior = scrollBehavior()
  // Lazy media above the section can grow while scrolling, so re-aim until it lands.
  for (let attempt = 0; attempt < 3; attempt++) {
    const offset = el.getBoundingClientRect().top - headerOffset()
    if (Math.abs(offset) < 2) break
    window.scrollTo({ top: window.scrollY + offset, behavior })
    if (behavior === 'auto') continue
    await new Promise(resolve => {
      const done = () => setTimeout(resolve, 50)
      window.addEventListener('scrollend', done, { once: true })
      setTimeout(done, 1200)
    })
  }
  history.replaceState(history.state, '', `#${id}`)
  activeSection.value = id
}
onMounted(() => {
  updateActiveSection()
  window.addEventListener('scroll', updateActiveSection, { passive: true })
  window.addEventListener('resize', updateActiveSection, { passive: true })
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', updateActiveSection)
  window.removeEventListener('resize', updateActiveSection)
})
watch(() => route.fullPath, () => nextTick(updateActiveSection))
const links = computed(() =>
  sections.map(({ id, key }) => ({
    id,
    label: t(key),
    to: `/#${id}`,
    active: (id === 'pricing' && route.path === '/pricing') || activeSection.value === id,
    onSelect: (event: Event) => goToSection(id, event),
  })))
const legal = computed(() => [
  { label: t('public.privacy'), to: '/privacy' },
  { label: t('public.terms'), to: '/terms' },
  { label: t('public.refund'), to: '/refund' },
])
const { canRegister } = useLandingOffer()
const { to: offerCtaPath, labelKey: offerCtaLabelKey } = publicOfferCta
const year = new Date().getFullYear()
</script>
<template>
  <div class="marketing">
    <ULink to="#main" class="skip-link">{{ t('public.skipToContent') }}</ULink
    ><UHeader
      v-model:open="menuOpen"
      class="marketing-header"
      title="Framic"
      :menu="{ fullscreen: route.path === '/', transition: true }"
      :ui="{
        root: 'bg-default/95 backdrop-blur border-default',
        container: 'max-w-[1220px] h-20 px-6 sm:px-10',
        content: 'marketing-menu',
        body: 'flex flex-1 flex-col',
      }"
      ><template #toggle="{ open, toggle }"
        ><UButton
          color="neutral"
          variant="ghost"
          class="marketing-burger -me-1.5 size-10 justify-center lg:hidden"
          :data-open="open"
          :data-animate="menuUsed"
          :aria-label="t(open ? 'public.closeMenu' : 'public.openMenu')"
          :aria-expanded="open"
          @click="toggle"
          ><span class="marketing-burger-box" aria-hidden="true"><span /><span /><span /></span></UButton
        ></template
      ><template #left><BrandLogo @click="goToTop" /></template><UNavigationMenu :items="links" /><template #right
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
          </USelect><UButton to="/login" variant="ghost" color="neutral" class="whitespace-nowrap">{{ t('public.login') }}</UButton
          ><UButton
            :to="offerCtaPath"
            trailing-icon="i-lucide-arrow-up-right"
            size="sm"
            class="rounded-lg whitespace-nowrap max-[379px]:px-2 max-[379px]:text-[11px]"
            >{{ t(offerCtaLabelKey) }}</UButton
          >
        </div></template
      ><template #body
        ><div class="flex flex-1 flex-col gap-8 lg:hidden">
          <nav class="flex flex-col gap-1.5">
            <ULink
              v-for="(link, index) in links"
              :key="link.to"
              :to="link.to"
              :aria-current="link.active ? 'location' : undefined"
              :style="{ '--stagger': index }"
              class="marketing-menu-item group relative flex items-center gap-4 rounded-xl border px-4 py-4 transition-all duration-200"
              :class="link.active
                ? 'border-primary/30 bg-primary/10 text-primary'
                : 'border-transparent text-highlighted hover:border-default hover:bg-elevated/60'"
              @click="link.onSelect($event)"
            >
              <span
                class="text-xs font-semibold tabular-nums transition-colors"
                :class="link.active ? 'text-primary' : 'text-dimmed'"
                aria-hidden="true"
              >{{ String(index + 1).padStart(2, '0') }}</span>
              <span class="flex-1 text-xl font-semibold tracking-tight">{{ link.label }}</span>
              <span
                class="size-2 rounded-full bg-primary transition-all duration-200"
                :class="link.active ? 'scale-100 opacity-100' : 'scale-0 opacity-0'"
                aria-hidden="true"
              />
            </ULink>
          </nav>
          <div
            class="marketing-menu-item mt-auto flex flex-col gap-6 border-t border-default pt-6"
            :style="{ '--stagger': links.length }"
          >
            <section class="flex flex-col gap-2.5" :aria-label="t('public.language')">
              <p class="text-xs font-semibold tracking-wider text-muted uppercase">{{ t('public.language') }}</p>
              <div class="grid grid-cols-3 gap-2">
                <UButton
                  v-for="item in publicLanguages"
                  :key="item.value"
                  :aria-pressed="language === item.value"
                  :aria-label="t(item.key)"
                  :color="language === item.value ? 'primary' : 'neutral'"
                  :variant="language === item.value ? 'soft' : 'outline'"
                  :icon="item.flag"
                  :label="item.code"
                  size="lg"
                  block
                  :class="language === item.value && 'ring ring-primary'"
                  @click="language = item.value"
                />
              </div>
            </section>
            <section class="flex flex-col gap-2.5" :aria-label="t('public.appearance')">
              <p class="text-xs font-semibold tracking-wider text-muted uppercase">{{ t('public.appearance') }}</p>
              <ClientOnly>
                <div class="grid grid-cols-2 gap-1 rounded-lg bg-elevated p-1">
                  <UButton
                    v-for="mode in appearanceModes"
                    :key="mode.value"
                    :aria-pressed="colorMode.value === mode.value"
                    :icon="mode.icon"
                    :label="t(mode.key)"
                    color="neutral"
                    variant="ghost"
                    block
                    class="transition-all"
                    :class="colorMode.value === mode.value
                      ? 'bg-default text-highlighted shadow-sm hover:bg-default'
                      : 'text-muted'"
                    @click="colorMode.preference = mode.value"
                  />
                </div>
                <template #fallback><div class="h-11 rounded-lg bg-elevated" /></template>
              </ClientOnly>
            </section>
            <div class="flex flex-col gap-2.5">
              <UButton
                :to="offerCtaPath"
                size="xl"
                trailing-icon="i-lucide-arrow-up-right"
                block
                class="rounded-xl"
              >{{ t(offerCtaLabelKey) }}</UButton>
              <UButton
                to="/login"
                variant="outline"
                color="neutral"
                size="xl"
                leading-icon="i-lucide-log-in"
                block
                class="rounded-xl"
              >{{ t('public.login') }}</UButton>
            </div>
          </div>
        </div></template></UHeader
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
            <nav class="flex flex-col items-start gap-[14px] text-[13px] max-sm:gap-3 max-sm:text-xs" :aria-label="t('public.exploreFramic')">
              <p class="mb-2 text-[9px] tracking-[1.1px] text-muted">{{ t('public.explore') }}</p>
              <ULink class="py-0.5 hover:text-primary" to="/#why-framic">{{ t('public.howItWorks') }}</ULink><ULink class="py-0.5 hover:text-primary" :to="offerCtaPath">{{ t(offerCtaLabelKey) }}</ULink
              ><ULink class="py-0.5 hover:text-primary" to="/#faq">{{ t('public.faq') }}</ULink>
            </nav>
            <nav class="flex flex-col items-start gap-[14px] text-[13px] max-sm:gap-3 max-sm:text-xs" :aria-label="t('public.accountAndHelp')">
              <p class="mb-2 text-[9px] tracking-[1.1px] text-muted">{{ t('public.getStarted') }}</p>
              <ULink v-if="canRegister" class="py-0.5 hover:text-primary" to="/signup">{{ t('public.createAccount') }}</ULink
              ><ULink class="py-0.5 hover:text-primary" to="/login">{{ t('public.loginAccount') }}</ULink><ULink class="py-0.5 hover:text-primary" to="/help">{{ t('public.helpCenter') }}</ULink>
            </nav>
          </div>
          <div class="flex items-center justify-between gap-[35px] py-10 pb-4 max-sm:gap-5 max-sm:py-8 max-sm:pb-3">
            <BrandLogo class="w-[102px] max-sm:w-[84px]" @click="goToTop" />
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
      <template #left>© {{ year }} Framic</template>
      <UNavigationMenu :items="legal" />
    </UFooter>
  </div>
</template>
