<script setup lang="ts">
import type { Research } from '~~/shared/schemas/monthly-plan'
import { contentLanguageForLocale } from '~~/shared/schemas/workspace'
import { readableText } from '~/utils/readable-text'

const props = defineProps<{ research: Research }>()
const { t } = useI18n()
type Part = { text: string; url?: string; title?: string }
type Line = { kind: 'heading' | 'bullet' | 'paragraph'; parts: Part[] }
const researchHeadingKeys: Record<string, string> = {
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

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
function translatedHeading(line: Line) {
  const heading = readableText(line.parts.map((part) => part.text).join('')).toLocaleLowerCase('sq')
  return t(researchHeadingKeys[heading] || heading)
}
function partsBetween(start: number, end: number): Part[] {
  const parts: Part[] = []
  let offset = start
  const approvedUrls = new Set(props.research.sources.map((source) => source.url))
  for (const citation of [...props.research.citations]
    .filter((item) => approvedUrls.has(item.url))
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
    const bullet = trimmed.match(/^(?:[-*•]|\d+[.)])\s+/)?.[0] || ''
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
const detectedLanguage = computed(() =>
  props.research.language ? contentLanguageForLocale(props.research.language.locale) : null,
)
</script>

<template>
  <div class="space-y-8">
    <section
      v-if="research.language"
      class="rounded-xl border border-primary/20 bg-primary/5 p-4"
    >
      <p class="text-xs font-medium uppercase tracking-wide text-primary">Gjuha e audiencës</p>
      <h3 class="mt-1 text-lg font-semibold text-highlighted">{{ detectedLanguage }}</h3>
      <p class="mt-2 text-sm leading-6 text-toned">{{ research.language.rationale }}</p>
      <p class="mt-2 text-xs text-muted">{{ research.language.audienceSummary }}</p>
    </section>
    <section class="rounded-xl border border-default bg-default p-4">
      <div class="flex items-start gap-3">
        <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <UIcon name="i-lucide-search-check" class="size-4.5 text-primary" />
        </div>
        <div>
          <p class="text-xs font-medium uppercase tracking-wide text-primary">{{ t('research.conclusions') }}</p>
          <div class="mt-1 flex flex-wrap items-center gap-2">
            <h3 class="text-lg font-semibold text-highlighted">{{ t('research.whatFound') }}</h3>
            <UBadge color="success" variant="subtle" size="sm">{{ t('research.verifiedEvidence') }}</UBadge>
          </div>
        </div>
      </div>
      <div class="mt-4 space-y-2.5">
        <component
          :is="line.kind === 'heading' ? 'h4' : line.kind === 'bullet' ? 'div' : 'p'"
          v-for="(line, index) in lines"
          :key="index"
          :class="{
            'pt-3 text-base font-semibold text-highlighted first:pt-0': line.kind === 'heading',
            'flex gap-2.5 rounded-xl bg-elevated/50 px-3.5 py-3 text-sm leading-6 text-toned':
              line.kind === 'bullet',
            'text-sm leading-7 text-toned': line.kind === 'paragraph',
          }"
        >
          <UIcon
            v-if="line.kind === 'bullet'"
            name="i-lucide-check"
            class="mt-1 size-4 shrink-0 text-primary"
          />
          <span>
            <template v-if="line.kind === 'heading'">{{ translatedHeading(line) }}</template>
            <template v-for="(part, partIndex) in line.parts" :key="partIndex">
              <template v-if="line.kind !== 'heading'">
              <ULink
                v-if="part.url"
                :to="part.url"
                target="_blank"
                rel="noopener noreferrer"
                class="font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary"
                :title="part.title"
                >{{ readableText(part.text) }}</ULink
              >
              <template v-else>{{ readableText(part.text) }}</template>
              </template>
            </template>
          </span>
        </component>
      </div>
    </section>

    <section>
      <div class="flex flex-wrap items-end justify-between gap-2">
        <div>
        <p class="text-xs font-medium uppercase tracking-wide text-muted">{{ t('research.transparency') }}</p>
        <h3 class="mt-1 text-lg font-semibold text-highlighted">{{ t('research.sources') }}</h3>
        </div>
        <p class="text-xs text-muted">
          {{ new Date(research.researchedAt).toLocaleDateString('sq-AL') }}
        </p>
      </div>
      <div class="mt-4 grid gap-3 md:grid-cols-2">
        <ULink
          v-for="(source, index) in research.sources"
          :key="source.url"
          :to="source.url"
          target="_blank"
          rel="noopener noreferrer"
          class="group flex min-w-0 items-start gap-3 rounded-xl border border-default p-4 transition hover:border-primary/30 hover:bg-elevated/50"
        >
          <span
            class="flex size-7 shrink-0 items-center justify-center rounded-md bg-elevated text-xs font-semibold text-muted"
            >{{ index + 1 }}</span
          >
          <span class="min-w-0 flex-1">
            <strong class="block truncate text-sm font-medium text-highlighted">{{
              source.title
            }}</strong>
            <span class="mt-1 block truncate text-xs text-muted">{{ hostname(source.url) }}</span>
          </span>
          <UIcon
            name="i-lucide-arrow-up-right"
            class="mt-0.5 size-4 shrink-0 text-muted transition group-hover:text-primary"
          />
        </ULink>
      </div>
    </section>
  </div>
</template>
