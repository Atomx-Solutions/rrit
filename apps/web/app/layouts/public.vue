<script setup lang="ts">
const route = useRoute()
const links = computed(() => [
  {
    label: 'Pse Rrit',
    to: '/#perse',
    active: route.path === '/' && route.hash === '#perse',
  },
  {
    label: 'Çmimet',
    to: route.path === '/' ? '/#cmimet' : '/pricing',
    active: route.path === '/pricing' || (route.path === '/' && route.hash === '#cmimet'),
  },
  {
    label: 'Pyetje të shpeshta',
    to: '/#pyetje',
    active: route.path === '/' && route.hash === '#pyetje',
  },
])
const legal = [
  { label: 'Privatësia', to: '/privacy' },
  { label: 'Kushtet', to: '/terms' },
]
const { trialLabel, canRegister } = useLandingOffer()
const year = new Date().getFullYear()
</script>
<template>
  <div class="marketing">
    <ULink to="#main" class="skip-link">Kalo te përmbajtja</ULink
    ><UHeader
      class="marketing-header"
      title="Rrit"
      :ui="{
        root: 'bg-default/95 backdrop-blur border-default',
        container: 'max-w-[1220px] h-20 px-6 sm:px-10',
      }"
      ><template #left><BrandLogo /></template><UNavigationMenu :items="links" /><template #right
        ><UColorModeButton
          aria-label="Ndrysho pamjen e faqes"
          color="neutral"
          variant="ghost"
          class="marketing-theme-toggle"
        /><UButton to="/login" variant="ghost" color="neutral" class="hidden sm:flex">Hyr</UButton
        ><UButton
          :to="canRegister ? '/signup' : '/help'"
          trailing-icon="i-lucide-arrow-up-right"
          size="sm"
          class="marketing-header-action rounded-lg"
          >{{ canRegister ? trialLabel : 'Na kontakto' }}</UButton
        ></template
      ><template #body
        ><UNavigationMenu
          :items="[...links, { label: 'Hyr në llogari', to: '/login' }]"
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
              <p>Më shumë kohë<br /><span>për biznesin tënd.</span></p>
              <span>Ti me biznesin. Rrit me postimet.</span>
            </div>
            <nav aria-label="Eksploro Rrit">
              <p>EKSPLORO</p>
              <ULink to="/#perse">Si funksionon</ULink><ULink to="/pricing">Paketat</ULink
              ><ULink to="/#pyetje">Pyetje të shpeshta</ULink>
            </nav>
            <nav aria-label="Llogaria dhe ndihma">
              <p>LE TË FILLOJMË</p>
              <ULink v-if="canRegister" to="/signup">Krijo llogarinë</ULink
              ><ULink to="/login">Hyr në llogari</ULink><ULink to="/help">Qendra e ndihmës</ULink>
            </nav>
          </div>
          <div class="marketing-footer-signoff">
            <BrandLogo class="marketing-footer-signature" />
            <p>
              Nga ideja jote,<br />te postimi i radhës.<UIcon
                name="i-lucide-arrow-up-right"
                aria-hidden="true"
              />
            </p>
          </div>
        </UContainer>
      </template>
      <template #left>© {{ year }} Rrit</template>
      <UNavigationMenu :items="legal" />
      <template #right>Për bizneset në Kosovë · Në shqip</template>
    </UFooter>
  </div>
</template>

<style scoped>
.marketing-theme-toggle {
  min-width: 36px;
  min-height: 36px;
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
