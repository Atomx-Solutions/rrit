<script setup lang="ts">
import type { Research } from '~~/shared/schemas/monthly-plan'
import { readableText } from '~/utils/readable-text'

const props = defineProps<{
  research: Research
  businessName: string
  month: string
}>()
const { t, locale } = useI18n()

type Part = { text: string; url?: string; title?: string }
type Line = { kind: 'heading' | 'bullet' | 'paragraph'; parts: Part[] }
type Section = { title: string; lines: Line[] }

const headingKeys: Record<string, string> = {
  'përmbledhja ekzekutive': 'research.executiveSummary',
  'executive summary': 'research.executiveSummary',
  'tregu dhe audienca': 'research.marketAudience',
  'market and audience': 'research.marketAudience',
  'sjellja në instagram': 'research.instagramBehavior',
  'instagram behavior': 'research.instagramBehavior',
  'sjellja në facebook': 'research.facebookBehavior',
  'facebook behavior': 'research.facebookBehavior',
  'mundësitë e përmbajtjes': 'research.contentOpportunities',
  'content opportunities': 'research.contentOpportunities',
  'të dhënat e vëzhguara për orarin': 'research.observedTiming',
  'observed timing data': 'research.observedTiming',
  'hipotezat e orarit': 'research.observedTiming',
  'timing hypotheses': 'research.observedTiming',
  'boshllëqet në të dhëna': 'research.dataGaps',
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
  const asciiHeading = heading.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const asciiKeys: Record<string, string> = {
    'permbledhja ekzekutive': 'research.executiveSummary',
    'tregu dhe audienca': 'research.marketAudience',
    'sjellja ne instagram': 'research.instagramBehavior',
    'sjellja ne facebook': 'research.facebookBehavior',
    'mundesite e permbajtjes': 'research.contentOpportunities',
    'te dhenat e vezhguara per orarin': 'research.observedTiming',
    'hipotezat e orarit': 'research.observedTiming',
    'boshllaqet ne te dhena': 'research.dataGaps',
  }
  return t(headingKeys[heading] || asciiKeys[asciiHeading] || heading)
}
function isTimingNotice(line: Line) {
  const text = readableText(line.parts.map((part) => part.text).join('')).toLocaleLowerCase('sq')
  return text.includes('nuk ka të dhëna') || text.includes('nuk ka te dhena')
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
    <section class="border-t-2 border-[#17694d] bg-white text-[#172033] print:break-inside-avoid">
      <div class="p-6 sm:p-8">
        <div class="flex items-start justify-between gap-5">
          <div>
            <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-[#17694d]">
              {{ t('research.reportEntryLabel') }}
            </p>
            <h2
              class="mt-3 max-w-2xl text-[1.55rem] font-semibold leading-tight tracking-[-0.03em] sm:text-3xl"
            >
              {{ t('research.reportEntryTitle') }}
            </h2>
          </div>
        </div>
        <p class="mt-5 max-w-4xl text-sm leading-7 text-[#475569]">
          {{ entryText || t('research.reportEntryFallback', { business: businessName, month }) }}
        </p>
      </div>
      <div class="grid border-y border-[#17694d] bg-[#17694d] sm:grid-cols-3">
        <div class="p-4 sm:px-6">
          <span class="text-xs text-[#c9ead6]">{{ t('research.sources') }}</span>
          <strong class="mt-1 block text-lg text-white">{{ research.sources.length }}</strong>
        </div>
        <div class="border-t border-white/20 p-4 sm:border-l sm:border-t-0 sm:px-6">
          <span class="text-xs text-[#c9ead6]">{{ t('research.reportApprovedSources') }}</span>
          <strong class="mt-1 block text-lg text-white">{{ approvedUrls.size }}</strong>
        </div>
        <div class="border-t border-white/20 p-4 sm:border-l sm:border-t-0 sm:px-6">
          <span class="text-xs text-[#c9ead6]">{{ t('research.reportDate') }}</span>
          <strong class="mt-1 block text-sm text-white">{{
            new Date(research.researchedAt).toLocaleDateString(
              locale === 'en-US' ? 'en-US' : 'sq-AL',
            )
          }}</strong>
        </div>
      </div>
    </section>

    <section
      class="research-explanation border-t-2 border-[#17694d] bg-white px-1 py-6 sm:py-8 print:border-0 print:p-0 print:[break-before:page]"
    >
      <div class="border-b border-[#e8eee9] pb-5">
        <p class="text-xs font-semibold uppercase tracking-[0.18em] text-[#17694d]">
          {{ t('research.reportExplanationLabel') }}
        </p>
        <h2 class="mt-2 text-2xl font-semibold tracking-tight text-[#17231d]">
          {{ t('research.reportExplanationTitle') }}
        </h2>
        <p class="mt-2 max-w-3xl text-sm leading-6 text-[#475569]">
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
            class="text-base font-semibold tracking-tight text-[#17231d] print:break-after-avoid"
          >
            {{ section.title }}
          </h3>
          <!-- A heading must not be the last thing on a printed page, so its
               first line is pulled onto the same page as the heading. -->
          <div class="mt-3 space-y-3 print:[&>*:first-child]:break-before-avoid">
            <component
              :is="line.kind === 'bullet' ? 'div' : 'p'"
              v-for="(line, lineIndex) in section.lines"
              :key="lineIndex"
              :class="
                line.kind === 'bullet'
                  ? 'print:break-inside-avoid flex gap-3 border-l-2 border-[#17694d] px-4 py-2.5 text-sm leading-6 text-[#46554d]'
                  : isTimingNotice(line)
                    ? 'print:break-inside-avoid border-l-2 border-[#17694d] bg-[#f8fafc] px-4 py-3 text-sm leading-7 text-[#334155]'
                    : 'print:break-inside-avoid text-sm leading-7 text-[#46554d]'
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
    </section>

    <section class="border-t-2 border-[#17694d] bg-white text-[#17231d] print:break-before-auto">
      <div
        class="flex flex-col gap-4 border-b border-[#e2e8f0] px-1 py-6 sm:flex-row sm:items-end sm:justify-between"
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
          class="inline-flex w-fit shrink-0 items-center gap-2 border border-[#cfe2d5] px-3 py-1.5 text-xs font-semibold text-[#17694d]"
        >
          <UIcon name="i-lucide-shield-check" class="size-3.5" />
          {{ approvedUrls.size }} {{ t('research.reportApprovedSources') }}
        </span>
      </div>
      <div class="divide-y divide-[#e2e8f0]">
        <ULink
          v-for="(source, index) in research.sources"
          :key="source.url"
          :to="source.url"
          target="_blank"
          rel="noopener noreferrer"
          class="group flex min-w-0 flex-wrap items-start gap-x-4 gap-y-2 py-4 text-left transition-colors hover:bg-[#f8fafc] sm:flex-nowrap sm:items-center print:break-inside-avoid"
        >
          <span
            class="flex size-7 shrink-0 items-center justify-center border border-[#cfe2d5] text-xs font-bold text-[#17694d]"
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

