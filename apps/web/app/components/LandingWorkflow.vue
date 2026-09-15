<script setup lang="ts">
const { t } = useI18n()
const step = ref('business')
const photo = '/images/table.jpg'
const items = computed(() => [
  {
    label: t('landing.business'),
    value: 'business',
    icon: 'i-lucide-store',
    title: t('landing.workflowBusinessTitle'),
    description: t('landing.workflowBusinessDescription'),
    detail: t('landing.workflowStepOne'),
  },
  {
    label: t('landing.post'),
    value: 'post',
    icon: 'i-lucide-image-plus',
    title: t('landing.workflowPostTitle'),
    description: t('landing.workflowPostDescription'),
    detail: t('landing.workflowStepTwo'),
  },
  {
    label: t('landing.calendar'),
    value: 'calendar',
    icon: 'i-lucide-calendar-days',
    title: t('landing.workflowCalendarTitle'),
    description: t('landing.workflowCalendarDescription'),
    detail: t('landing.workflowStepThree'),
  },
])
</script>

<template>
  <UTabs
    v-model="step"
    :items="items"
    class="landing-workflow"
    :ui="{
      list: 'landing-workflow-tabs',
      trigger: 'landing-workflow-trigger',
      indicator: 'rounded-lg',
      content: 'mt-5 focus-visible:outline-offset-4',
    }"
  >
    <template #content="{ item }">
      <UCard class="landing-workflow-card" :ui="{ body: 'p-0 sm:p-0' }">
        <div class="landing-workflow-layout">
          <div class="landing-workflow-copy">
            <span class="landing-kicker">{{ item.detail }}</span>
            <h3>{{ item.title }}</h3>
            <p>{{ item.description }}</p>
            <div class="landing-workflow-progress" aria-hidden="true">
              <span
                v-for="entry in items"
                :key="entry.value"
                :class="{ 'is-active': entry.value === step }"
              />
            </div>
          </div>
          <div class="landing-workflow-visual">
            <div v-if="item.value === 'business'" class="landing-business-example">
              <div class="landing-example-cover">
                <img
                  :src="photo"
                  :alt="t('landing.businessExampleAlt')"
                  width="1000"
                  height="667"
                  loading="lazy"
                />
              </div>
              <div class="landing-example-profile">
                <span class="landing-example-avatar"
                  ><UIcon name="i-lucide-coffee" aria-hidden="true"
                /></span>
                <div><strong>{{ t('legacy.yourCafe') }}</strong><span>{{ t('legacy.coffeeSocialPrishtina') }}</span></div>
              </div>
              <dl class="landing-example-facts">
                <div>
                  <dt>{{ t('legacy.whatWeOffer') }}</dt>
                  <dd>{{ t('legacy.goodCoffeePlace') }}</dd>
                </div>
                <div>
                  <dt>{{ t('legacy.howWeSpeak') }}</dt>
                  <dd>{{ t('legacy.warmSimple') }}</dd>
                </div>
              </dl>
            </div>
            <div v-else-if="item.value === 'post'" class="landing-post-example">
              <div class="landing-example-topline">
                <span>{{ t('legacy.yourPost') }}</span
                ><UBadge variant="subtle" color="neutral" size="sm">{{ t('landing.postApproval') }}</UBadge>
              </div>
              <img
                :src="photo"
                :alt="t('landing.postExampleAlt')"
                width="1000"
                height="667"
                loading="lazy"
              />
              <p>
                {{ t('landing.postExampleCopy') }}
              </p>
              <div class="landing-example-ready">
                <UIcon name="i-lucide-check-check" aria-hidden="true" /> {{ t('landing.postReady') }}
              </div>
            </div>
            <div v-else class="landing-calendar-example">
              <div class="landing-example-topline">
                <span>{{ t('legacy.yourWeek') }}</span><UIcon name="i-lucide-calendar-days" aria-hidden="true" />
              </div>
              <div class="landing-calendar-days" aria-hidden="true">
                <span v-for="(day, index) in ['H', 'M', 'M', 'E', 'P', 'S', 'D']" :key="index">{{
                  day
                }}</span>
              </div>
              <div class="landing-calendar-item">
                <span class="landing-day">{{ t('legacy.mondayUpper') }}</span>
                <div><strong>{{ t('legacy.morningCoffee') }}</strong><span>{{ t('legacy.photoPlusText') }}</span></div>
                <UIcon name="i-lucide-circle-check" :aria-label="t('landing.approved')" />
              </div>
              <div class="landing-calendar-item">
                <span class="landing-day">{{ t('legacy.wednesdayUpper') }}</span>
                <div><strong>{{ t('legacy.corner') }}</strong><span>{{ t('landing.postApproval') }}</span></div>
                <UIcon name="i-lucide-clock-3" :aria-label="t('landing.postApproval')" />
              </div>
              <div class="landing-calendar-item">
                <span class="landing-day">{{ t('legacy.fridayUpper') }}</span>
                <div><strong>{{ t('legacy.weekendMeeting') }}</strong><span>{{ t('landing.draft') }}</span></div>
                <UIcon name="i-lucide-pencil-line" :aria-label="t('landing.draft')" />
              </div>
              <p class="landing-calendar-note">{{ t('legacy.organizedWeek') }}</p>
            </div>
            <p class="landing-example-label">{{ t('legacy.workflowExample') }}</p>
          </div>
        </div>
      </UCard>
    </template>
  </UTabs>
</template>
