<script setup lang="ts">
const links = [
  { label: 'Si funksionon', to: '/#features' },
  { label: 'Çmimet', to: '/pricing' },
  { label: 'Siguria', to: '/security' },
  { label: 'Ndihma', to: '/help' },
]
const legal = [
  { label: 'Privatësia', to: '/privacy' },
  { label: 'Kushtet', to: '/terms' },
]
</script>
<template>
  <div class="marketing">
    <ULink to="#main" class="skip-link">Kalo te përmbajtja</ULink
    ><UHeader
      title="Rrit"
      :ui="{ root: 'bg-default/95 backdrop-blur border-default', container: 'max-w-7xl h-16' }"
      ><template #left><BrandLogo /></template><UNavigationMenu :items="links" /><template #right
        ><UButton to="/login" variant="ghost" color="neutral" class="hidden sm:flex">Hyr</UButton
        ><UButton to="/app" variant="outline" trailing-icon="i-lucide-arrow-right" size="sm"
          >Fillo falas</UButton
        ></template
      ><template #body
        ><UNavigationMenu
          :items="[...links, { label: 'Hyr në llogari', to: '/login' }]"
          orientation="vertical" /></template></UHeader
    ><UMain id="main"><slot /></UMain
    ><UFooter :ui="{ root: 'border-t border-default', container: 'max-w-7xl py-8' }"
      ><template #left
        ><div>
          <BrandLogo />
          <p class="text-xs text-muted mt-2">Ide të mira. Biznese që rriten.</p>
        </div></template
      ><UNavigationMenu :items="legal" /><template #right
        ><p class="text-xs text-muted">© 2026 Rrit · Për bizneset në Kosovë</p></template
      ></UFooter
    >
  </div>
</template>
