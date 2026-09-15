<script setup lang="ts">
const { t } = useI18n()
const photos = ['/images/table.jpg', '/images/pastry.jpg', '/images/interior.jpg']
const photoLabels = computed(() => [t('landing.moment'), t('landing.product'), t('landing.story')])
const weekDays = computed(() => [
  t('legacy.mondayShort'), t('legacy.tuesdayShort'), t('legacy.wednesdayShort'),
  t('legacy.thursdayShort'), t('legacy.fridayShort'), t('legacy.saturdayShort'),
  t('legacy.sundayShort'),
])
</script>

<template>
  <div class="landing-benefit-grid">
    <UCard class="landing-benefit-card landing-benefit-library" :ui="{ body: 'p-7 sm:p-9 h-full' }">
      <span class="landing-feature-icon"><UIcon name="i-lucide-images" aria-hidden="true" /></span>
      <h3>{{ t('legacy.photoWords') }}<br />{{ t('legacy.samePlace') }}</h3>
      <p>{{ t('legacy.workMoments') }}</p>
      <div class="landing-media-strip" aria-hidden="true">
        <div v-for="(photo, index) in photos" :key="photo">
          <img :src="photo" alt="" width="1000" height="667" loading="lazy" /><span>{{
            photoLabels[index]
          }}</span>
        </div>
      </div>
      <div class="landing-benefit-foot">
        <UIcon name="i-lucide-folder-check" aria-hidden="true" /><span
          >{{ t('landing.businessMaterials') }}</span
        >
      </div>
    </UCard>
    <UCard class="landing-benefit-card landing-benefit-calendar" :ui="{ body: 'p-7 sm:p-8' }">
      <div class="landing-feature-heading">
        <span class="landing-feature-icon"
          ><UIcon name="i-lucide-calendar-range" aria-hidden="true" /></span
        ><span class="landing-feature-eyebrow">{{ t('landing.moreOrder') }}</span>
      </div>
      <h3>{{ t('legacy.clearWeek') }}</h3>
      <p>{{ t('landing.clearWeekDescription') }}</p>
      <div class="landing-week-preview" aria-hidden="true">
        <span>{{ weekDays[0] }}<i /></span><span>{{ weekDays[1] }}</span
        ><span>{{ weekDays[2] }}<i /></span><span>{{ weekDays[3] }}</span
        ><span>{{ weekDays[4] }}<i /></span><span>{{ weekDays[5] }}</span
        ><span>{{ weekDays[6] }}</span>
      </div>
    </UCard>
    <UCard class="landing-benefit-card landing-benefit-approval" :ui="{ body: 'p-7 sm:p-8' }">
      <div class="landing-feature-heading">
        <span class="landing-feature-icon"
          ><UIcon name="i-lucide-check-check" aria-hidden="true" /></span
        ><span class="landing-feature-eyebrow">{{ t('legacy.controlStays') }}</span>
      </div>
      <h3>{{ t('landing.yourBusiness') }}<br />{{ t('landing.lastWord') }}</h3>
      <p>{{ t('landing.approvalDescription') }}</p>
    </UCard>
  </div>
</template>
