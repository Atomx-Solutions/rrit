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
      <div class="flex flex-wrap gap-2">
        <UButton :to="`${base}/content`" color="neutral" variant="outline" icon="i-lucide-files">
          {{ t('nav.content') }}
        </UButton>
        <UButton :to="`${base}/calendar`" variant="outline" icon="i-lucide-calendar-days">
          {{ t('monthly.viewCalendar') }}
        </UButton>
      </div>
    </template>

    <MonthlyPlannerPanel :month="month" />

    <UCard :ui="{ body: 'p-4' }">
      <div class="grid gap-4 md:grid-cols-3">
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
          <UIcon name="i-lucide-image" class="mt-0.5 size-4 shrink-0 text-primary" />
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
