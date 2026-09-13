<script setup lang="ts">
import type { Research } from '~~/shared/schemas/monthly-plan'

const props = defineProps<{ research: Research }>()
type Part = { text: string; url?: string; title?: string }
type Line = { kind: 'heading' | 'bullet' | 'paragraph'; parts: Part[] }

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
function partsBetween(start: number, end: number): Part[] {
  const parts: Part[] = []
  let offset = start
  for (const citation of [...props.research.citations].sort((a, b) => a.start - b.start)) {
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
</script>

<template>
  <div class="space-y-8">
    <section class="rounded-xl border border-default bg-default p-4">
      <div class="flex items-start gap-3">
        <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <UIcon name="i-lucide-search-check" class="size-4.5 text-primary" />
        </div>
        <div>
          <p class="text-xs font-medium uppercase tracking-wide text-primary">Përfundimet</p>
          <h3 class="mt-1 text-lg font-semibold text-highlighted">Çfarë zbuloi hulumtimi</h3>
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
            <template v-for="(part, partIndex) in line.parts" :key="partIndex">
              <ULink
                v-if="part.url"
                :to="part.url"
                target="_blank"
                rel="noopener noreferrer"
                class="font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary"
                :title="part.title"
                >{{ part.text }}</ULink
              >
              <template v-else>{{ part.text }}</template>
            </template>
          </span>
        </component>
      </div>
    </section>

    <section>
      <div class="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p class="text-xs font-medium uppercase tracking-wide text-muted">Transparenca</p>
          <h3 class="mt-1 text-lg font-semibold text-highlighted">Burimet e konsultuara</h3>
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
