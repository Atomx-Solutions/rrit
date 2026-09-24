<script setup lang="ts">
import { formatDate } from '~~/shared/utils/format'
definePageMeta({ layout: 'dashboard', middleware: 'workspace' })
const { data, base } = useWorkspace()
const { t } = useI18n()
useSeoMeta({ title: () => `${t('overview.title')} · Rrit` })
const { data: meta } = await useFetch('/api/meta/status', { key: 'meta-status' })
const reviews = computed(() => data.value.posts.filter((p) => p.status === 'review'))
const upcoming = computed(() =>
  data.value.posts
    .filter((p) => p.status === 'scheduled')
    .sort((a, b) => (a.scheduledAt || '').localeCompare(b.scheduledAt || '')),
)

const chartDays = 14
const chartHeight = 44
const chartBaseline = 40

function dateKey(value: Date | string, timezone: string) {
  const date = typeof value === 'string' ? new Date(value) : value
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}

const activity = computed(() => {
  const timezone = data.value.preferences.timezone
  const today = new Date()
  const days = Array.from({ length: chartDays }, (_, index) => {
    const date = new Date(today)
    date.setHours(12, 0, 0, 0)
    date.setDate(date.getDate() - (chartDays - index - 1))
    const key = dateKey(date, timezone)
    const isToday = index === chartDays - 1
    const value = data.value.posts.filter((post) => {
      const source = post.proposedAt || post.publishedAt || post.scheduledAt
      return source ? dateKey(source, timezone) === key : isToday
    }).length

    return {
      key,
      label: formatDate(`${key}T12:00:00.000Z`, timezone, true),
      value,
      x: (index / (chartDays - 1)) * 100,
    }
  })
  const max = Math.max(1, ...days.map((day) => day.value))
  return days.map((day) => ({
    ...day,
    y: chartBaseline - (day.value / max) * (chartBaseline - 8),
  }))
})

function smoothPath(points: Array<{ x: number; y: number }>) {
  if (!points.length) return ''
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`
  let path = `M ${points[0]!.x} ${points[0]!.y}`
  for (let index = 0; index < points.length - 1; index++) {
    const previous = points[index - 1] || points[index]!
    const current = points[index]!
    const next = points[index + 1]!
    const following = points[index + 2] || next
    const controlOne = {
      x: current.x + (next.x - previous.x) / 6,
      y: current.y + (next.y - previous.y) / 6,
    }
    const controlTwo = {
      x: next.x - (following.x - current.x) / 6,
      y: next.y - (following.y - current.y) / 6,
    }
    path += ` C ${controlOne.x} ${controlOne.y}, ${controlTwo.x} ${controlTwo.y}, ${next.x} ${next.y}`
  }
  return path
}

const activityPath = computed(() => smoothPath(activity.value))
const activityAreaPath = computed(() => `${activityPath.value} L 100 ${chartHeight} L 0 ${chartHeight} Z`)
const activityPeak = computed(() => activity.value.reduce((peak, day) => (day.value > peak.value ? day : peak), activity.value[0]!))
const activityTotal = computed(() => activity.value.reduce((total, day) => total + day.value, 0))
const summaries = computed(() => [
  {
    label: t('overview.allPosts'),
    value: data.value.posts.length,
    icon: 'i-lucide-files',
    to: `${base.value}/content`,
  },
  {
    label: t('overview.awaitingApproval'),
    value: reviews.value.length,
    icon: 'i-lucide-file-check',
    to: `${base.value}/content?status=review`,
  },
  {
    label: t('overview.drafts'),
    value: data.value.posts.filter((p) => p.status === 'draft').length,
    icon: 'i-lucide-file-pen-line',
    to: `${base.value}/content?status=draft`,
  },
  {
    label: t('overview.scheduled'),
    value: upcoming.value.length,
    icon: 'i-lucide-calendar-days',
    to: `${base.value}/calendar`,
  },
])
</script>
<template>
  <DashboardPage :title="t('overview.title')" :description="`${data.brand.name} · ${data.brand.city}`">
    <template #actions
      ><UButton :to="`${base}/content/new`" variant="outline" icon="i-lucide-plus"
        >{{ t('content.createPost') }}</UButton
      ></template
    >
    <UPageGrid class="grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-px">
      <UPageCard
        v-for="summary in summaries"
        :key="summary.label"
        :to="summary.to"
        variant="outline"
        class="lg:rounded-none lg:first:rounded-l-lg lg:last:rounded-r-lg hover:z-1"
        :ui="{ container: 'p-4 sm:p-5 gap-4' }"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs sm:text-sm text-muted">{{ summary.label }}</span>
          <UIcon :name="summary.icon" class="size-4 shrink-0 text-primary" />
        </div>
        <span class="text-3xl font-semibold text-highlighted tabular-nums">{{
          summary.value
        }}</span>
      </UPageCard>
    </UPageGrid>

    <UCard :ui="{ body: 'p-0 sm:p-0' }" class="overflow-hidden">
      <div class="flex flex-wrap items-start justify-between gap-4 px-5 pt-5 sm:px-6 sm:pt-6">
        <div>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-chart-spline" class="size-4 text-primary" />
            <h2 class="text-sm font-semibold">{{ t('overview.activityTitle') }}</h2>
          </div>
          <p class="mt-1 text-sm text-muted">{{ t('overview.activityDescription') }}</p>
        </div>
        <UBadge color="primary" variant="subtle" :label="t('overview.activityPosts', { count: activityTotal })" />
      </div>

      <div class="px-5 pb-5 pt-4 sm:px-6 sm:pb-6">
        <div class="relative h-56 overflow-hidden rounded-lg border border-default bg-elevated/20">
          <svg
            class="absolute inset-0 h-full w-full"
            viewBox="0 0 100 44"
            preserveAspectRatio="none"
            role="img"
            :aria-label="t('overview.activityDescription')"
          >
            <defs>
              <linearGradient id="overview-activity-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" class="text-primary" stop-color="currentColor" stop-opacity="0.24" />
                <stop offset="100%" class="text-primary" stop-color="currentColor" stop-opacity="0.02" />
              </linearGradient>
              <pattern id="overview-activity-grid" width="5" height="11" patternUnits="userSpaceOnUse">
                <path d="M 5 0 L 0 0 0 11" fill="none" class="stroke-default" stroke-width="0.12" />
              </pattern>
            </defs>
            <rect width="100" height="44" fill="url(#overview-activity-grid)" />
            <path :d="activityAreaPath" fill="url(#overview-activity-fill)" class="text-primary" />
            <path :d="activityPath" fill="none" class="stroke-primary" stroke-width="0.45" vector-effect="non-scaling-stroke" />
            <circle
              v-for="day in activity"
              :key="day.key"
              :cx="day.x"
              :cy="day.y"
              r="0.85"
              class="fill-primary stroke-default"
              stroke-width="0.18"
              vector-effect="non-scaling-stroke"
            />
          </svg>
          <div class="pointer-events-none absolute inset-x-3 bottom-3 flex justify-between text-[11px] text-muted">
            <span>{{ activity[0]?.label }}</span>
            <span>{{ activity[Math.floor(chartDays / 2)]?.label }}</span>
            <span>{{ activity[chartDays - 1]?.label }}</span>
          </div>
        </div>

        <div class="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-muted">
          <span>{{ t('overview.activityPeak', { date: activityPeak.label, count: activityPeak.value }) }}</span>
          <ULink :to="`${base}/content`" class="inline-flex items-center gap-1 font-medium text-highlighted hover:text-primary">
            {{ t('overview.viewAllPosts') }}
            <UIcon name="i-lucide-arrow-right" class="size-3.5" />
          </ULink>
        </div>
        <p v-if="!activityTotal" class="mt-3 text-sm text-muted">{{ t('overview.activityEmpty') }}</p>
      </div>
    </UCard>
    <UPageGrid class="grid-cols-1 lg:grid-cols-2 gap-5">
      <UCard :ui="{ body: 'p-5 sm:p-6' }">
        <div class="flex justify-between items-center gap-3 mb-5">
          <h2 class="text-sm font-semibold">{{ t('overview.nextCalendarPost') }}</h2>
          <UIcon name="i-lucide-calendar-days" class="size-4 text-muted" />
        </div>
        <ULink
          v-if="upcoming[0]"
          :to="`${base}/content/${upcoming[0].id}`"
          class="flex items-center gap-4 group"
        >
          <MediaImage
            :src="upcoming[0].image"
            alt=""
            width="64"
            height="64"
            class="size-16 shrink-0 rounded-md object-cover"
          />
          <div class="min-w-0 flex-1">
            <p class="text-xs text-muted mb-1.5">
              {{ formatDate(upcoming[0].scheduledAt!, data.preferences.timezone) }} ·
              {{ upcoming[0].channel }}
            </p>
            <h3 class="text-sm font-medium text-highlighted group-hover:text-primary">
              {{ upcoming[0].title }}
            </h3>
          </div>
          <UIcon name="i-lucide-arrow-up-right" class="size-4 text-muted shrink-0" />
        </ULink>
        <p v-else class="text-sm text-muted">{{ t('overview.noUpcomingPost') }}</p>
        <UButton
          :to="`${base}/calendar`"
          variant="link"
          color="neutral"
          size="sm"
          class="mt-4 px-0"
          trailing-icon="i-lucide-arrow-right"
          >{{ t('nav.calendar') }}</UButton
        >
      </UCard>
      <UCard :ui="{ body: 'p-5 sm:p-6' }">
        <div class="flex justify-between items-center gap-3 mb-4">
          <h2 class="text-sm font-semibold">{{ t('nav.meta') }}</h2>
          <UBadge color="neutral" variant="outline" size="sm">{{
            meta?.connection?.status === 'connected' ? t('overview.connected') : t('overview.connectionRequired')
          }}</UBadge>
        </div>
        <p class="text-sm text-muted leading-relaxed max-w-lg">
          {{
            meta?.connection?.status === 'connected'
              ? t('overview.connectedPage', { page: meta.connection.pageName || '' })
              /* : 'Faqja e lidhur: ' +
                meta.connection.pageName +
                '. Përditëso postimet për të parë historikun e biznesit.' */
              : t('overview.connectDescription')
          }}
        </p>
        <UButton
          :to="`${base}/social-posts`"
          variant="outline"
          color="neutral"
          size="sm"
          class="mt-5"
          trailing-icon="i-lucide-arrow-right"
          >{{ t('nav.viewPosts') }}</UButton
        >
      </UCard>
    </UPageGrid>
  </DashboardPage>
</template>
