<script setup lang="ts">
import type { Research } from '~~/shared/schemas/monthly-plan'
import { readableText } from '~/utils/readable-text'

const props = defineProps<{
  research: Research
  businessName: string
  month: string
}>()
const { t } = useI18n()

type Part = { text: string; url?: string; title?: string }
type Line = { kind: 'heading' | 'bullet' | 'paragraph'; parts: Part[] }
type Section = { title: string; lines: Line[] }

const headingKeys: Record<string, string> = {
  'pÃ«rmbledhja ekzekutive': 'research.executiveSummary',
  'executive summary': 'research.executiveSummary',
  'tregu dhe audienca': 'research.marketAudience',
  'market and audience': 'research.marketAudience',
  'sjellja nÃ« instagram': 'research.instagramBehavior',
  'instagram behavior': 'research.instagramBehavior',
  'sjellja nÃ« facebook': 'research.facebookBehavior',
  'facebook behavior': 'research.facebookBehavior',
  'mundÃ«sitÃ« e pÃ«rmbajtjes': 'research.contentOpportunities',
  'content opportunities': 'research.contentOpportunities',
  'tÃ« dhÃ«nat e vÃ«zhguara pÃ«r orarin': 'research.observedTiming',
  'observed timing data': 'research.observedTiming',
  'hipotezat e orarit': 'research.observedTiming',
  'timing hypotheses': 'research.observedTiming',
  'boshllÃ«qet nÃ« tÃ« dhÃ«na': 'research.dataGaps',
  'data gaps': 'research.dataGaps',
}

const approvedUrls = computed(() => new Set(props.research.sources.map((source) => source.url)))

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function translatedHeading(line: Line) {
  const heading = readableText(line.parts.map((part) => part.text).join('')).toLocaleLowerCase('sq')
  return t(headingKeys[heading] || heading)
}

function partsBetween(start: number, end: number): Part[] {
  const parts: Part[] = []
  let offset = start
  for (const citation of [...props.research.citations]
    .filter((item) => approvedUrls.value.has(item.url))
    .sort((a, b) => a.start - b.start)) {
    const citationStart = Math.max(start, citation.start)
    const citationEnd = Math.min(end, citation.end)
    if (citationEnd <= citationStart || citationStart < offset) continue
    if (citationStart > offset)
      parts.push({ text: props.research.text.slice(offset, citationStart) })
    parts.push({
      text: props.research.text.slice(citationStart, citationEnd),
      url: citation.url,
      title: citation.title,
    })
    offset = citationEnd
  }
  if (offset < end) parts.push({ text: props.research.text.slice(offset, end) })
  return parts
}

const lines = computed<Line[]>(() => {
  const result: Line[] = []
  let start = 0
  for (const raw of props.research.text.split('\n')) {
    const trimmed = raw.trim()
    const leading = raw.indexOf(trimmed)
    const heading = trimmed.match(/^#{1,4}\s+/)?.[0] || (/^\*\*.+\*\*$/.test(trimmed) ? '**' : '')
    const bullet = trimmed.match(/^(?:[-*â€¢]|\d+[.)])\s+/)?.[0] || ''
    const prefix = heading || bullet
    const suffix = heading === '**' ? '**' : ''
    if (trimmed && trimmed.length > prefix.length + suffix.length) {
      result.push({
        kind: heading ? 'heading' : bullet ? 'bullet' : 'paragraph',
        parts: partsBetween(
          start + Math.max(0, leading) + prefix.length,
          start + Math.max(0, leading) + trimmed.length - suffix.length,
        ),
      })
    }
    start += raw.length + 1
  }
  return result
})

const sections = computed<Section[]>(() => {
  const result: Section[] = []
  let current: Section = { title: '', lines: [] }
  for (const line of lines.value) {
    if (line.kind === 'heading') {
      if (current.lines.length) result.push(current)
      current = { title: translatedHeading(line), lines: [] }
    } else current.lines.push(line)
  }
  if (current.lines.length) result.push(current)
  return result
})

const entryText = computed(() => {
  const paragraphs = lines.value
    .filter((line) => line.kind === 'paragraph')
    .slice(0, 2)
    .map((line) => readableText(line.parts.map((part) => part.text).join('')))
  return paragraphs.join(' ')
})
</script>

<template>
  <UContainer as="div" class="research-report-document !max-w-none !p-0 space-y-7">
    <UCard
      as="section"
      class="research-entry overflow-hidden rounded-[20px] bg-[#17694d] text-white shadow-[0_18px_48px_-34px_rgba(23,105,77,0.85)] print:[-webkit-print-color-adjust:exact] print:[print-color-adjust:exact]"
      :ui="{ root: 'ring-0', body: 'p-0' }"
    >
      <div class="p-6 sm:p-8">
        <div class="flex items-start justify-between gap-5">
          <div>
            <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-[#c9ead6]">
              {{ t('research.reportEntryLabel') }}
            </p>
            <h2
              class="mt-3 max-w-2xl text-[1.55rem] font-semibold leading-tight tracking-[-0.03em] sm:text-3xl"
            >
              {{ t('research.reportEntryTitle') }}
            </h2>
          </div>
          <UIcon name="i-lucide-compass" class="size-7 shrink-0 text-[#c9ead6]" />
        </div>
        <p class="mt-5 max-w-4xl text-sm leading-7 text-[#e3f2e8]">
          {{ entryText || t('research.reportEntryFallback', { business: businessName, month }) }}
        </p>
      </div>
      <div class="grid gap-px border-t border-white/15 bg-white/15 sm:grid-cols-3">
        <div class="bg-[#17694d] p-4 sm:px-6">
          <span class="text-xs text-[#c9ead6]">{{ t('research.sources') }}</span>
          <strong class="mt-1 block text-lg">{{ research.sources.length }}</strong>
        </div>
        <div class="bg-[#17694d] p-4 sm:px-6">
          <span class="text-xs text-[#c9ead6]">{{ t('research.reportApprovedSources') }}</span>
          <strong class="mt-1 block text-lg">{{ approvedUrls.size }}</strong>
        </div>
        <div class="bg-[#17694d] p-4 sm:px-6">
          <span class="text-xs text-[#c9ead6]">{{ t('research.reportDate') }}</span>
          <strong class="mt-1 block text-sm">{{
            new Date(research.researchedAt).toLocaleDateString('sq-AL')
          }}</strong>
        </div>
      </div>
    </UCard>

    <UCard
      as="section"
      class="research-explanation rounded-[20px] border border-[#dce6df] bg-white p-6 sm:p-8 print:rounded-none print:border-0 print:p-0 print:[break-before:page]"
      :ui="{ root: 'ring-0', body: 'p-0' }"
    >
      <div class="border-b border-[#e8eee9] pb-5">
        <p class="text-xs font-semibold uppercase tracking-[0.18em] text-[#17694d]">
          {{ t('research.reportExplanationLabel') }}
        </p>
        <h2 class="mt-2 text-2xl font-semibold tracking-tight text-[#17231d]">
          {{ t('research.reportExplanationTitle') }}
        </h2>
        <p class="mt-2 max-w-3xl text-sm leading-6 text-[#64736b]">
          {{ t('research.reportExplanationDescription') }}
        </p>
      </div>

      <div class="mt-6 space-y-7">
        <section
          v-for="(section, sectionIndex) in sections"
          :key="`${section.title}-${sectionIndex}`"
          class="research-section"
        >
          <h3
            v-if="section.title"
            class="research-section-title text-base font-semibold tracking-tight text-[#17231d]"
          >
            {{ section.title }}
          </h3>
          <div class="mt-3 space-y-3">
            <component
              :is="line.kind === 'bullet' ? 'div' : 'p'"
              v-for="(line, lineIndex) in section.lines"
              :key="lineIndex"
              :class="
                line.kind === 'bullet'
                  ? 'research-line flex gap-3 rounded-xl bg-[#f3f7f3] px-4 py-3 text-sm leading-6 text-[#46554d]'
                  : 'research-line text-sm leading-7 text-[#46554d]'
              "
            >
              <UIcon
                v-if="line.kind === 'bullet'"
                name="i-lucide-check"
                class="mt-1 size-4 shrink-0 text-[#17694d]"
              />
              <span>
                <template v-for="(part, partIndex) in line.parts" :key="partIndex">
                  <ULink
                    v-if="part.url && approvedUrls.has(part.url)"
                    :to="part.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="font-medium text-[#17694d] underline decoration-[#17694d]/30 underline-offset-4"
                    >{{ readableText(part.text) }}</ULink
                  >
                  <template v-else>{{ readableText(part.text) }}</template>
                </template>
              </span>
            </component>
          </div>
        </section>
      </div>
    </UCard>

    <section
      class="research-sources overflow-hidden rounded-[20px] border border-[#dce6df] bg-white text-[#17231d] shadow-[0_18px_45px_-38px_rgba(23,105,77,0.45)]"
    >
      <div
        class="flex flex-col gap-4 border-b border-[#e4ebe6] bg-[#f7faf8] px-6 py-6 sm:flex-row sm:items-end sm:justify-between sm:px-8"
      >
        <div>
          <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-[#17694d]">
            {{ t('research.transparency') }}
          </p>
          <h2 class="mt-2 text-2xl font-semibold tracking-[-0.025em] text-[#17231d]">
            {{ t('research.sources') }}
          </h2>
          <p class="mt-2 max-w-2xl text-sm leading-6 text-[#64736b]">
            {{ t('research.reportExplanationDescription') }}
          </p>
        </div>
        <span
          class="inline-flex w-fit shrink-0 items-center gap-2 rounded-full border border-[#cfe2d5] bg-white px-3 py-1.5 text-xs font-semibold text-[#17694d]"
        >
          <UIcon name="i-lucide-shield-check" class="size-3.5" />
          {{ approvedUrls.size }} {{ t('research.reportApprovedSources') }}
        </span>
      </div>
      <div class="divide-y divide-[#e8eee9] px-6 sm:px-8">
        <ULink
          v-for="(source, index) in research.sources"
          :key="source.url"
          :to="source.url"
          target="_blank"
          rel="noopener noreferrer"
          class="research-source group flex min-w-0 flex-wrap items-start gap-x-4 gap-y-2 py-4 text-left transition-colors hover:bg-[#f7faf8] sm:flex-nowrap sm:items-center"
        >
          <span
            class="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#e9f3eb] text-xs font-bold text-[#17694d]"
            >{{ index + 1 }}</span
          >
          <span class="min-w-0 flex-1">
            <strong class="block text-sm font-semibold leading-5 text-[#17231d]">{{
              readableText(source.title)
            }}</strong>
          </span>
          <span
            class="ml-12 flex w-full min-w-0 items-center gap-2 text-xs font-medium text-[#64736b] transition-colors group-hover:text-[#17694d] sm:ml-0 sm:w-auto sm:max-w-[38%] sm:shrink-0"
          >
            <span class="truncate">{{ hostname(source.url) }}</span>
            <UIcon name="i-lucide-arrow-up-right" class="size-3.5 shrink-0" />
          </span>
        </ULink>
      </div>
    </section>
  </UContainer>
</template>

<style scoped>
@media print {
  .research-entry,
  .research-line,
  .research-source {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .research-section-title {
    break-after: avoid;
    page-break-after: avoid;
  }

  .research-section-title + div > :first-child {
    break-before: avoid;
    page-break-before: avoid;
  }

  .research-sources {
    break-before: auto;
    page-break-before: auto;
  }
}
</style>
