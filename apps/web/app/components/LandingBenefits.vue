<script setup lang="ts">
const photos = ['/images/table.jpg', '/images/pastry.jpg', '/images/interior.jpg']
</script>

<template>
  <div class="landing-benefit-grid">
    <UCard class="landing-benefit-card landing-benefit-library" :ui="{ body: 'p-7 sm:p-9 h-full' }">
      <span class="landing-feature-icon"><UIcon name="i-lucide-images" aria-hidden="true" /></span>
      <h3>Fotografitë dhe fjalët.<br />Në të njëjtin vend.</h3>
      <p>Produktet, ambienti, momentet e punës. Gjeji lehtë dhe ktheji në postimin e radhës.</p>
      <div class="landing-media-strip" aria-hidden="true">
        <div v-for="(photo, index) in photos" :key="photo">
          <img :src="photo" alt="" width="1000" height="667" loading="lazy" /><span>{{
            ['Një moment.', 'Një produkt.', 'Një histori.'][index]
          }}</span>
        </div>
      </div>
      <div class="landing-benefit-foot">
        <UIcon name="i-lucide-folder-check" aria-hidden="true" /><span
          >Materialet e biznesit, gjithmonë pranë.</span
        >
      </div>
    </UCard>
    <UCard class="landing-benefit-card landing-benefit-calendar" :ui="{ body: 'p-7 sm:p-8' }">
      <div class="landing-feature-heading">
        <span class="landing-feature-icon"
          ><UIcon name="i-lucide-calendar-range" aria-hidden="true" /></span
        ><span class="landing-feature-eyebrow">MË SHUMË RREGULL</span>
      </div>
      <h3>Një javë që e sheh qartë.</h3>
      <p>E di çfarë është gati dhe çfarë kërkon ende vëmendje. Pa e mbajtur të gjithën në mend.</p>
      <div class="landing-week-preview" aria-hidden="true">
        <span>Hën<i /></span><span>Mar</span><span>Mër<i /></span><span>Enj</span
        ><span>Pre<i /></span><span>Sht</span><span>Die</span>
      </div>
    </UCard>
    <UCard class="landing-benefit-card landing-benefit-approval" :ui="{ body: 'p-7 sm:p-8' }">
      <div class="landing-feature-heading">
        <span class="landing-feature-icon"
          ><UIcon name="i-lucide-check-check" aria-hidden="true" /></span
        ><span class="landing-feature-eyebrow">KONTROLLI MBETET TE TI</span>
      </div>
      <h3>Duket si biznesi yt.<br />Sepse fjala e fundit është e jotja.</h3>
      <p>Lexo tekstin, shiko fotografinë dhe mirato vetëm atë që të përfaqëson.</p>
    </UCard>
  </div>
</template>
