<script setup lang="ts">
import type { Asset } from '~~/shared/schemas/workspace'

definePageMeta({ layout: false, middleware: 'workspace' })

const route = useRoute()
const { data: workspace } = useWorkspace()
const { t } = useI18n()
const reportType = computed<'research' | 'strategy'>(() =>
  route.query.type === 'strategy' ? 'strategy' : 'research',
)
const month = computed(() => (typeof route.query.month === 'string' ? route.query.month : ''))
const { data: planner, error } = await useFetch('/api/ai/monthly-plan', {
  query: computed(() => ({ month: month.value })),
  key: computed(() => `monthly-report-${month.value}`),
})

const plan = computed(() => planner.value?.plan)
const originalPhotos = computed(() =>
  workspace.value.assets
    .filter(
      (asset): asset is Asset & { url: string } =>
        asset.kind === 'photo' && !!asset.url && !asset.generated,
    )
    .slice(0, 40),
)
const reportTitle = computed(() =>
  reportType.value === 'strategy'
    ? t('monthly.strategyReportTitle')
    : t('monthly.researchReportTitle'),
)
const reportDescription = computed(() =>
  reportType.value === 'strategy'
    ? t('monthly.strategyReportDescription')
    : t('monthly.researchReportDescription'),
)
const pdfUrl = computed(
  () =>
    `/api/ai/monthly-report.pdf?month=${encodeURIComponent(month.value)}&type=${reportType.value}`,
)

useHead({
  title: () => `${reportTitle.value} · ${workspace.value.brand.name} · Rrit`,
})

function downloadPdf() {
  if (!import.meta.client) return
  const anchor = document.createElement('a')
  anchor.href = pdfUrl.value
  anchor.download = `rrit-${reportType.value}-${month.value}.pdf`
  anchor.click()
}
</script>

<template>
  <UContainer
    as="div"
    class="report-page min-h-screen max-w-none bg-[#eef3ef] px-3 py-3 text-[#1f2b25] sm:px-6 sm:py-6 print:bg-white print:p-0"
  >
    <UCard
      as="div"
      class="report-sheet mx-auto max-w-[1180px] rounded-[26px] border border-[#dce6df] bg-white px-5 py-6 shadow-[0_24px_70px_-48px_rgba(23,105,77,0.55)] sm:px-10 sm:py-9 print:max-w-none print:rounded-none print:border-0 print:px-0 print:py-0 print:shadow-none"
      :ui="{ root: 'ring-0', body: 'p-0' }"
    >
      <header
        class="report-header flex flex-col justify-between gap-7 border-b border-[#dce6df] pb-8 sm:flex-row sm:items-start print:pt-[0.25in]"
      >
        <div>
          <img src="/logo.svg" alt="Rrit" width="102" height="44" class="h-9 w-auto" />
          <p class="mt-7 text-[10px] font-bold uppercase tracking-[0.24em] text-[#17694d]">
            {{ t('monthly.reportLabel') }}
          </p>
          <h1
            class="mt-2 text-[2rem] font-semibold leading-none tracking-[-0.04em] text-[#17231d] sm:text-[2.65rem]"
          >
            {{ reportTitle }}
          </h1>
          <p class="mt-3 max-w-2xl text-sm leading-6 text-[#64736b]">{{ reportDescription }}</p>
        </div>
        <div class="flex flex-col items-start gap-3 sm:items-end">
          <div
            class="rounded-full border border-[#cfe2d5] bg-[#f2f8f3] px-3 py-1.5 text-[11px] font-semibold text-[#17694d]"
          >
            {{ workspace.brand.name }} · {{ month }}
          </div>
          <UButton
            class="report-actions shadow-sm print:hidden"
            size="sm"
            color="primary"
            icon="i-lucide-file-down"
            @click="downloadPdf"
          >
            {{ t('monthly.saveAsPdf') }}
          </UButton>
        </div>
      </header>

      <UMain v-if="plan" as="main" class="report-content pt-8 sm:pt-10" :ui="{ base: 'min-w-0' }">
        <section
          class="report-intro mb-7 overflow-hidden rounded-[20px] bg-[#17694d] text-white shadow-[0_20px_55px_-34px_rgba(23,105,77,0.9)] print:break-inside-avoid print:shadow-none print:[-webkit-print-color-adjust:exact] print:[print-color-adjust:exact]"
        >
          <div class="p-6 sm:p-8">
            <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-[#c9ead6]">
              {{ t('monthly.reportForBusiness') }}
            </p>
            <h2
              class="mt-3 text-[1.7rem] font-semibold leading-tight tracking-[-0.03em] sm:text-3xl"
            >
              {{ workspace.brand.name }}
            </h2>
            <p class="mt-3 max-w-3xl text-sm leading-7 text-[#e3f2e8]">
              {{ workspace.brand.description || t('monthly.reportBusinessFallback') }}
            </p>
          </div>
          <div
            class="flex flex-wrap gap-2 border-t border-white/15 px-6 py-4 text-xs text-[#d5ebdc] sm:px-8"
          >
            <span class="rounded-md border border-white/20 px-2.5 py-1.5">{{
              workspace.brand.industry
            }}</span>
            <span
              v-if="workspace.brand.city"
              class="rounded-md border border-white/20 px-2.5 py-1.5"
              >{{ workspace.brand.city }}</span
            >
            <span class="rounded-md border border-white/20 px-2.5 py-1.5">{{ month }}</span>
          </div>
        </section>

        <MonthlyStrategyView
          v-if="reportType === 'strategy' && plan.strategy"
          :strategy="plan.strategy"
          :assets="originalPhotos"
        />
        <ResearchReportDocument
          v-else-if="reportType === 'research' && plan.research"
          :research="plan.research"
          :business-name="workspace.brand.name"
          :month="month"
        />
        <div v-else class="rounded-3xl border border-[#dce6df] bg-white p-8 text-center">
          <h2 class="text-lg font-semibold">{{ t('monthly.reportUnavailable') }}</h2>
          <p class="mt-2 text-sm text-[#64736b]">{{ t('monthly.reportUnavailableDescription') }}</p>
        </div>
      </UMain>

      <div v-else class="rounded-3xl border border-[#dce6df] bg-white p-8 text-center">
        <UIcon name="i-lucide-file-warning" class="mx-auto size-8 text-[#b97918]" />
        <h2 class="mt-4 text-lg font-semibold">{{ t('monthly.reportUnavailable') }}</h2>
        <p class="mt-2 text-sm text-[#64736b]">
          {{ error?.message || t('monthly.reportUnavailableDescription') }}
        </p>
      </div>

      <footer
        class="report-footer mt-10 flex flex-col justify-between gap-2 border-t border-[#dce6df] pt-5 text-xs text-[#7a8780] sm:flex-row print:mb-[0.25in]"
      >
        <span>{{ t('monthly.reportFooter') }}</span>
        <span>Rrit · {{ workspace.brand.name }}</span>
      </footer>
    </UCard>
  </UContainer>
</template>

<style>
@page {
  size: A4;
  margin: 14mm 13mm 16mm;
}

@media print {
  html,
  body {
    background: white !important;
  }

  .report-page,
  .report-sheet {
    width: auto !important;
    min-height: 0 !important;
  }

  .report-header,
  .report-intro,
  .research-entry,
  .report-footer {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .report-footer {
    break-before: avoid;
    page-break-before: avoid;
  }
}
</style>
