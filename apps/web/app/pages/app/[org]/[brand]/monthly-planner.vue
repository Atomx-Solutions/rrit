<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'workspace' })
const { data, base } = useWorkspace()
const { t } = useI18n()
useSeoMeta({ title: () => `${t('monthly.pageTitle')} · Framic` })
const month = computed(() =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: data.value.preferences.timezone,
    year: 'numeric',
    month: '2-digit',
  }).format(new Date()),
)
</script>

<template>
  <DashboardPage
    :title="t('monthly.pageTitle')"
    :description="t('monthly.pageDescription')"
    :toolbar-border="false"
  >
    <template #actions>
      <!-- Two separate shortcuts to other pages, alike, each marked with an
           arrow so neither reads as a selected tab. On a phone only icons show. -->
      <div class="flex items-center gap-2">
        <UButton
          :to="`${base}/content`"
          variant="outline"
          icon="i-lucide-layout-grid"
          trailing-icon="i-lucide-arrow-up-right"
          :aria-label="t('nav.posts')"
        >
          <span class="hidden sm:inline">{{ t('nav.posts') }}</span>
        </UButton>
        <UButton
          :to="`${base}/calendar`"
          variant="outline"
          icon="i-lucide-calendar-days"
          trailing-icon="i-lucide-arrow-up-right"
          :aria-label="t('monthly.viewCalendar')"
        >
          <span class="hidden sm:inline">{{ t('monthly.viewCalendar') }}</span>
        </UButton>
      </div>
    </template>

    <MonthlyPlannerPanel :month="month" />

    <UCard :ui="{ body: 'p-4 sm:p-5' }">
      <div class="grid gap-4 sm:grid-cols-3">
        <div class="flex items-start gap-3">
          <UIcon name="i-lucide-search" class="mt-0.5 size-4 shrink-0 text-primary" />
          <div>
            <h2 class="text-sm font-semibold">{{ t('monthly.realResearch') }}</h2>
            <p class="mt-1 text-xs leading-5 text-muted">
              {{ t('monthly.realResearchDescription') }}
            </p>
          </div>
        </div>
        <div class="flex items-start gap-3">
          <UIcon name="i-lucide-lightbulb" class="mt-0.5 size-4 shrink-0 text-primary" />
          <div>
            <h2 class="text-sm font-semibold">{{ t('monthly.strategyDesign') }}</h2>
            <p class="mt-1 text-xs leading-5 text-muted">
              {{ t('monthly.strategyDesignDescription') }}
            </p>
          </div>
        </div>
        <div class="flex items-start gap-3">
          <UIcon name="i-lucide-shield-check" class="mt-0.5 size-4 shrink-0 text-primary" />
          <div>
            <h2 class="text-sm font-semibold">{{ t('monthly.youDecide') }}</h2>
            <p class="mt-1 text-xs leading-5 text-muted">
              {{ t('monthly.youDecideDescription') }}
            </p>
          </div>
        </div>
      </div>
    </UCard>
  </DashboardPage>
</template>
