<script setup lang="ts">
import { imageFallback, imageSrcset, landingImageSizes } from '~~/shared/utils/responsive-image'
const { t } = useI18n()
// Illustrative compositions only. These never create or publish business records.
const photos = {
  burger: '/images/burger-small.webp',
}
// The source print renders at 31% of the scene, the composed poster at 47%.
const sourcePhotoSizes = landingImageSizes(30, 192)
const composedPhotoSizes = landingImageSizes(45, 291)
</script>
<template>
  <div class="landing-stories">
    <section class="landing-feature-section" aria-labelledby="studio-title">
      <UContainer class="landing-container landing-feature-row">
        <div class="landing-feature-copy">
          <p class="landing-kicker">{{ t('legacy.fromWhatYouDo') }}</p>
          <h2 id="studio-title">{{ t('legacy.yourPhoto') }}<br /><span>{{ t('legacy.fullCharacter') }}</span></h2>
          <p>{{ t('landing.storyOneDescription') }}</p>
          <div class="landing-feature-detail">
            <UIcon name="i-lucide-fingerprint" aria-hidden="true" /><span
              >{{ t('legacy.businessIsYours') }}<br /><strong>{{ t('legacy.finalWord') }}</strong></span
            >
          </div>
        </div>
        <LandingScene
          class="landing-studio-scene"
          :label="t('landing.studioSceneLabel')"
          :caption="t('landing.studioSceneCaption')"
        >
          <div class="landing-studio-orbit" aria-hidden="true" />
          <UCard class="landing-source-photo landing-depth-item" :ui="{ body: 'p-2 sm:p-2' }">
            <img
              :src="imageFallback(photos.burger)"
              :srcset="imageSrcset(photos.burger)"
              :sizes="sourcePhotoSizes"
              :alt="t('landing.originalBurgerAlt')"
              width="600"
              height="499"
              loading="lazy"
              decoding="async"
            />
            <span>{{ t('legacy.yourPhotoUpper') }}</span>
          </UCard>
          <UCard
            class="landing-composed-post landing-depth-item"
            :ui="{ body: 'p-0 sm:p-0 h-full' }"
          >
            <div class="landing-composed-art">
              <span>{{ t('legacy.withTaste') }}</span>
              <p>{{ t('legacy.yesAlso') }}<br /><em>{{ t('legacy.bite') }}</em></p>
              <img
                :src="imageFallback(photos.burger)"
                :srcset="imageSrcset(photos.burger)"
                :sizes="composedPhotoSizes"
                :alt="t('landing.composedBurgerAlt')"
                width="600"
                height="499"
                loading="lazy"
                decoding="async"
              />
              <span>{{ t('legacy.roomForTaste') }}</span>
            </div>
          </UCard>
          <div
            class="landing-palette landing-depth-item"
            :aria-label="t('landing.paletteAlt')"
          >
            <i /><i /><i /><span>Aa</span>
          </div>
          <div class="landing-review-chip landing-depth-item">
            <UIcon name="i-lucide-circle-check" aria-hidden="true" /> {{ t('landing.approvedByYou') }}
          </div>
        </LandingScene>
      </UContainer>
    </section>
    <section class="landing-feature-section landing-tennis-section" aria-labelledby="tennis-title">
      <UContainer class="landing-container landing-feature-row">
        <div class="landing-feature-copy">
          <p class="landing-kicker">{{ t('legacy.forBusinessesLikeYours') }}</p>
          <h2 id="tennis-title">{{ t('legacy.youCreateExperience') }}<br /><span>{{ t('legacy.giveItRoom') }}</span></h2>
          <p>{{ t('landing.storyTwoDescription') }}</p>
          <div class="landing-feature-detail">
            <UIcon name="i-lucide-move-up-right" aria-hidden="true" />
            <span
              >{{ t('legacy.sportServices') }}<br /><strong
                >{{ t('legacy.roomForStory') }}</strong
              ></span
            >
          </div>
        </div>
        <LandingScene
          class="landing-tennis-scene"
          :label="t('landing.tennisSceneLabel')"
          :caption="t('landing.tennisSceneCaption')"
        >
          <LandingTennisPost />
          <div class="landing-tennis-cursor landing-depth-item" aria-hidden="true">
            <UIcon name="i-lucide-mouse-pointer-2" />
          </div>
          <div class="landing-tennis-publish landing-depth-item" aria-hidden="true">
            <span>{{ t('landing.publish') }}</span><UIcon name="i-lucide-arrow-up-right" />
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
                <span><strong>klubi.yt</strong><small>{{ t('legacy.instagramPost') }}</small></span>
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
                <p><strong>klubi.yt</strong> {{ t('legacy.onCourt') }}</p>
                <span class="landing-instagram-confirmation">
                  <UIcon name="i-lucide-circle-check" /> {{ t('landing.publishedSimulation') }}
                </span>
              </div>
            </template>
          </UCard>
        </LandingScene>
      </UContainer>
    </section>
  </div>
</template>
