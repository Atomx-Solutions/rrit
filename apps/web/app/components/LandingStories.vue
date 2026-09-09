<script setup lang="ts">
// Illustrative compositions only. These never create or publish business records.
const photos = {
  burger: '/images/burger.jpg',
}
</script>
<template>
  <div class="landing-stories">
    <section class="landing-feature-section" aria-labelledby="studio-title">
      <UContainer class="landing-container landing-feature-row">
        <div class="landing-feature-copy">
          <p class="landing-kicker">01 / NGA AJO QË E BËN TI</p>
          <h2 id="studio-title">Një foto e jotja.<br /><span>Plot karakter.</span></h2>
          <p>
            Produkti yt, fjalët e tua, stili yt. Mbaji bashkë dhe përgatit një postim që të
            përfaqëson.
          </p>
          <div class="landing-feature-detail">
            <UIcon name="i-lucide-fingerprint" aria-hidden="true" /><span
              >Biznesi është i yti.<br /><strong>Edhe fjala e fundit.</strong></span
            >
          </div>
        </div>
        <LandingScene
          class="landing-studio-scene"
          label="pamjen e studios"
          caption="Nga fotografia te kompozimi · shembull ilustrues"
        >
          <div class="landing-studio-orbit" aria-hidden="true" />
          <UCard class="landing-source-photo landing-depth-item" :ui="{ body: 'p-2 sm:p-2' }">
            <img
              :src="photos.burger"
              alt="Fotografia origjinale e burgerit"
              width="900"
              height="748"
              loading="lazy"
              decoding="async"
            />
            <span>FOTOGRAFIA JOTE</span>
          </UCard>
          <UCard
            class="landing-composed-post landing-depth-item"
            :ui="{ body: 'p-0 sm:p-0 h-full' }"
          >
            <div class="landing-composed-art">
              <span>ME SHIJE. ME KARAKTER.</span>
              <p>Po, edhe<br /><em>një kafshatë.</em></p>
              <img
                :src="photos.burger"
                alt="E njëjta fotografi në një kompozim postimi me ngjyra të ngrohta"
                width="900"
                height="748"
                loading="lazy"
                decoding="async"
              />
              <span>GJITHMONË KA VEND PËR SHIJE. ↗</span>
            </div>
          </UCard>
          <div
            class="landing-palette landing-depth-item"
            aria-label="Paleta e shembullit: portokalli, krem dhe kafe"
          >
            <i /><i /><i /><span>Aa</span>
          </div>
          <div class="landing-review-chip landing-depth-item">
            <UIcon name="i-lucide-circle-check" aria-hidden="true" /> Ti e miraton.
          </div>
        </LandingScene>
      </UContainer>
    </section>
    <section class="landing-feature-section landing-tennis-section" aria-labelledby="tennis-title">
      <UContainer class="landing-container landing-feature-row">
        <div class="landing-feature-copy">
          <p class="landing-kicker">02 / PËR BIZNESE SI I YTI</p>
          <h2 id="tennis-title">Ti krijon përvojën.<br /><span>Jepi vend në postim.</span></h2>
          <p>
            Një ndeshje pas pune. Një orë për veten. Trego çfarë e bën të veçantë biznesin tënd, me
            postime që kanë stilin tënd.
          </p>
          <div class="landing-feature-detail">
            <UIcon name="i-lucide-move-up-right" aria-hidden="true" />
            <span
              >Sport, shërbime apo diçka krejt tjetër.<br /><strong
                >Ka vend për historinë tënde.</strong
              ></span
            >
          </div>
        </div>
        <LandingScene
          class="landing-tennis-scene"
          label="pamjen e tenisit"
          caption="Simulim vizual · krijimi dhe publikimi i një postimi"
        >
          <LandingTennisPost />
          <div class="landing-tennis-cursor landing-depth-item" aria-hidden="true">
            <UIcon name="i-lucide-mouse-pointer-2" />
          </div>
          <div class="landing-tennis-publish landing-depth-item" aria-hidden="true">
            <span>Posto</span><UIcon name="i-lucide-arrow-up-right" />
          </div>
          <UCard
            class="landing-tennis-instagram landing-tennis-published landing-depth-item"
            aria-hidden="true"
            :ui="{
              header: 'p-0 sm:p-0 border-0',
              body: 'p-0 sm:p-0',
              footer: 'p-0 sm:p-0 border-0',
            }"
          >
            <template #header>
              <div class="landing-instagram-account">
                <span class="landing-instagram-avatar">K</span>
                <span><strong>klubi.yt</strong><small>Instagram · postimi yt</small></span>
                <UIcon name="i-lucide-instagram" class="landing-instagram-mark" />
                <UIcon name="i-lucide-ellipsis" />
              </div>
            </template>
            <LandingTennisPost preview />
            <template #footer>
              <div class="landing-instagram-footer">
                <div class="landing-instagram-actions">
                  <UIcon name="i-lucide-heart" /><UIcon name="i-lucide-message-circle" />
                  <UIcon name="i-lucide-send" /><UIcon name="i-lucide-bookmark" />
                </div>
                <p><strong>klubi.yt</strong> Në fushë. Pas pune.</p>
                <span class="landing-instagram-confirmation">
                  <UIcon name="i-lucide-circle-check" /> U publikua · simulim
                </span>
              </div>
            </template>
          </UCard>
        </LandingScene>
      </UContainer>
    </section>
  </div>
</template>
