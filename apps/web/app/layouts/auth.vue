<script setup lang="ts">
const { t } = useI18n()
</script>

<template>
  <div class="auth-layout">
    <aside class="auth-story">
      <BrandLogo />
      <div>
        <span class="eyebrow">{{ t('public.skipBusiness') }}</span>
        <h2 class="mt-5">{{ t('public.everyDay') }}<br />{{ t('public.growOpportunity') }}</h2>
        <p>{{ t('public.businessPosts') }}</p>
        <img
          src="/images/table.jpg"
          :alt="t('dashboard.coffeeAlt')"
          width="440"
          height="230"
          class="mt-8"
          style="
            border-radius: 16px;
            width: 100%;
            max-width: 440px;
            height: 220px;
            object-fit: cover;
          "
        />
      </div>
      <p class="small">{{ t('public.inAlbanian') }}</p>
    </aside>
    <main class="auth-form">
      <ULink to="/" class="small muted block mb-8">← {{ t('public.backToRrit') }}</ULink><slot />
    </main>
  </div>
</template>
