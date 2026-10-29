<script setup lang="ts">
import {
  calendarPeriod,
  defaultCalendarView,
  dayInZone,
  moveCalendar,
  type CalendarView,
} from '~~/shared/utils/calendar'
import { monthlyPlannerPath } from '~/utils/creation-route'
definePageMeta({ layout: 'dashboard', middleware: 'workspace' })
const { data, base } = useWorkspace()
const { t } = useI18n()
useSeoMeta({ title: () => `${t('nav.calendar')} · Framic` })
const today = computed(() => dayInZone(new Date(), data.value.preferences.timezone))
const anchor = ref(today.value)
const view = ref<CalendarView>(defaultCalendarView)
const monthNames = computed(() => [
  t('calendar.months.january'),
  t('calendar.months.february'),
  t('calendar.months.march'),
  t('calendar.months.april'),
  t('calendar.months.may'),
  t('calendar.months.june'),
  t('calendar.months.july'),
  t('calendar.months.august'),
  t('calendar.months.september'),
  t('calendar.months.october'),
  t('calendar.months.november'),
  t('calendar.months.december'),
])
const period = computed(() => calendarPeriod(anchor.value, view.value, monthNames.value))
const posts = computed(() =>
  data.value.posts
    .map((p) => ({ ...p, scheduledAt: p.scheduledAt || p.proposedAt || null }))
    .filter((p) => p.scheduledAt)
    .sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!)),
)
const localDay = (value: string) => dayInZone(value, data.value.preferences.timezone)
const visible = computed(() =>
  posts.value.filter((p) => {
    const day = localDay(p.scheduledAt!)
    return day >= period.value.start && day <= period.value.end
  }),
)
// Grouped once instead of filtering every post for every cell of the grid.
const postsByDay = computed(() => {
  const days = new Map<string, typeof posts.value>()
  for (const post of posts.value) {
    const key = localDay(post.scheduledAt!)
    const existing = days.get(key)
    if (existing) existing.push(post)
    else days.set(key, [post])
  }
  return days
})
const dayPosts = (key: string) => postsByDay.value.get(key) || []

// A seven column grid of post cards needs about 45px per day on a phone, which
// fits no title. The phone grid therefore shows each day as a number with a dot
// per post, and the list underneath belongs to the day you tap.
const pickedDay = ref<string | null>(null)
// "Today" returns to the current period; it shows only once the view has left it.
const showsToday = computed(() => today.value >= period.value.start && today.value <= period.value.end)
function goToDay(day: string) {
  anchor.value = day
  pickedDay.value = day
}
const activeDay = computed(() => {
  if (view.value === 'list') return null
  if (pickedDay.value) return pickedDay.value
  // Nothing tapped yet: today when the period holds it, else the first day with
  // something on it, so the list below is never pointlessly empty.
  if (today.value >= period.value.start && today.value <= period.value.end) return today.value
  return period.value.days.find((day) => !day.outside && dayPosts(day.key).length)?.key
    || period.value.start
})
const dayList = computed(() =>
  view.value === 'list' || !activeDay.value ? visible.value : dayPosts(activeDay.value),
)

// Monday first, matching the grid. Intl is not used for these: not every
// browser ships Albanian weekday and month names, which is why this page
// already carries its own month names.
const weekdayNames = computed(() => [
  t('calendar.monday'),
  t('calendar.tuesday'),
  t('calendar.wednesday'),
  t('calendar.thursday'),
  t('calendar.friday'),
  t('calendar.saturday'),
  t('calendar.sunday'),
])
const weekdayNarrow = computed(() => weekdayNames.value.map((name) => name.slice(0, 1)))
const activeDayLabel = computed(() => {
  if (!activeDay.value) return ''
  const [year, month, day] = activeDay.value.split('-').map(Number)
  const weekday = (new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay() + 6) % 7
  return `${weekdayNames.value[weekday]}, ${day} ${monthNames.value[month! - 1]}`
})

const { page, pageSize, total, paginated } = usePagination(dayList)
watch([anchor, view], () => {
  pickedDay.value = null
})
watch([anchor, view, activeDay], () => {
  page.value = 1
})
function move(direction: number) {
  anchor.value = moveCalendar(anchor.value, view.value, direction)
}
</script>
<template>
  <DashboardPage
    :title="t('nav.calendar')"
    :toolbar-border="false"
  >
    <template #toolbar>
      <!-- The period sits in the middle with the create action on its right.
           The views take the left on a wide screen and a row of their own
           below on a phone. -->
      <div class="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-x-2 gap-y-3 border-b border-default pt-1">
        <div class="justify-self-start">
          <UButton
            v-if="!showsToday"
            variant="outline"
            icon="i-lucide-rotate-ccw"
            :aria-label="t('calendar.today')"
            @click="goToDay(today)"
          >
            <span class="hidden sm:inline">{{ t('calendar.today') }}</span>
          </UButton>
        </div>
        <UTabs
          v-model="view"
          :items="[
            { label: t('calendar.list'), value: 'list', icon: 'i-lucide-list' },
            { label: t('calendar.week'), value: 'week', icon: 'i-lucide-calendar-range' },
            { label: t('calendar.month'), value: 'month', icon: 'i-lucide-calendar-days' },
          ]"
          :content="false"
          variant="link"
          size="sm"
          class="order-last col-span-3 self-end justify-self-center"
          :ui="{ list: 'border-0' }"
          :aria-label="t('calendar.view')"
        />
        <div class="flex items-center">
          <UButton
            icon="i-lucide-chevron-left"
            :aria-label="view === 'week' ? t('calendar.previousWeek') : t('calendar.previousMonth')"
            color="neutral"
            variant="ghost"
            @click="move(-1)"
          />
          <h2 class="min-w-32 whitespace-nowrap px-1 text-center text-sm font-medium capitalize" aria-live="polite">{{ period.title }}</h2>
          <UButton
            icon="i-lucide-chevron-right"
            :aria-label="view === 'week' ? t('calendar.nextWeek') : t('calendar.nextMonth')"
            color="neutral"
            variant="ghost"
            @click="move(1)"
          />
        </div>
        <!-- Posts are created in AI planning, so one action leads there; on a
             phone only its icon shows. -->
        <UButton
          :to="monthlyPlannerPath(base)"
          variant="outline"
          icon="i-lucide-plus"
          class="justify-self-end"
          :aria-label="t('content.createPost')"
        >
          <span class="hidden sm:inline">{{ t('content.createPost') }}</span>
        </UButton>
      </div>
    </template>
    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div
        class="flex flex-wrap justify-between gap-2 px-3 py-2 border-b border-default text-[11px] text-muted"
      >
        <span>{{ visible.length }} {{ t('calendar.postsIn') }} {{ view === 'week' ? t('calendar.weekLower') : t('calendar.monthLower') }}</span
        ><span class="hidden sm:inline">{{ t('calendar.localTime') }} · {{ data.preferences.timezone }}</span>
      </div>
      <div v-if="view !== 'list'" class="hidden md:block">
        <div class="grid grid-cols-7">
          <div
            v-for="day in weekdayNames"
            :key="day"
            class="text-[11px] text-muted text-center py-2"
          >
            {{ day }}
          </div>
        </div>
        <div class="grid grid-cols-7">
          <div
            v-for="day in period.days"
            :key="day.key"
            class="border-t border-r border-default p-1.5 min-w-0"
            :class="[
              view === 'week' ? 'min-h-52' : 'min-h-20',
              day.outside && view === 'month' ? 'bg-elevated/25 text-muted' : '',
            ]"
          >
            <span
              class="inline-flex size-6 items-center justify-center rounded-md text-xs"
              :class="day.key === today ? 'ring ring-primary text-primary font-semibold' : ''"
              :aria-current="day.key === today ? 'date' : undefined"
              >{{ day.day }}</span
            >
            <ULink
              v-for="post in posts.filter((p) => localDay(p.scheduledAt!) === day.key)"
              :key="post.id"
              :to="`${base}/content/${post.id}`"
              class="block border border-default rounded-md p-1.5 mt-1.5 hover:border-primary text-[11px] text-default"
              :aria-label="`${t('calendar.openPost')}: ${post.title}`"
              ><span class="flex items-center gap-1.5 text-muted mb-1"
                ><UIcon
                  :name="channelIcon(post.channel)"
                  class="size-3.5"
                /><span>{{
                  new Intl.DateTimeFormat('en-GB', {
                    timeZone: data.preferences.timezone,
                    hour: '2-digit',
                    minute: '2-digit',
                  }).format(new Date(post.scheduledAt!))
                }}</span></span
              ><span class="line-clamp-2 leading-relaxed">{{ post.title }}</span
              ><span class="block text-muted mt-1">{{
                ['draft', 'review'].includes(post.status)
                  ? t('calendar.proposalAwaitingApproval')
                  : post.publicationMode === 'automatic'
                    ? t('calendar.automaticPublication')
                    : t('calendar.calendarOnly')
              }}</span></ULink
            >
          </div>
        </div>
      </div>
      <!-- The phone grid: a day is a number and a dot per post, and tapping one
           filters the list below to that day. -->
      <div v-if="view !== 'list'" class="md:hidden">
        <div class="grid grid-cols-7">
          <div
            v-for="(day, index) in weekdayNarrow"
            :key="index"
            class="py-1.5 text-center text-[10px] text-muted"
            aria-hidden="true"
          >
            {{ day }}
          </div>
        </div>
        <div class="grid grid-cols-7">
          <UButton
            v-for="day in period.days"
            :key="day.key"
            color="neutral"
            variant="ghost"
            :class="[
              'flex min-h-12 flex-col items-center gap-1 rounded-none border-t border-default p-0 py-1.5',
              day.outside ? 'text-muted' : '',
              day.key === activeDay ? 'bg-elevated' : '',
            ]"
            :aria-pressed="day.key === activeDay"
            :aria-label="`${day.day}: ${dayPosts(day.key).length} ${t('calendar.postsIn')}`"
            :aria-current="day.key === today ? 'date' : undefined"
            @click="pickedDay = day.key"
          >
            <span
              class="inline-flex size-6 items-center justify-center rounded-md text-xs"
              :class="day.key === today ? 'ring ring-primary font-semibold text-primary' : ''"
              >{{ day.day }}</span
            >
            <span class="flex h-1.5 items-center gap-0.5">
              <span
                v-for="dot in Math.min(dayPosts(day.key).length, 3)"
                :key="dot"
                class="size-1 rounded-full bg-primary"
              />
            </span>
          </UButton>
        </div>
        <p class="border-t border-default px-3 py-2 text-[11px] text-muted">
          {{ activeDayLabel }}
        </p>
      </div>
      <div :class="view !== 'list' ? 'md:hidden' : ''">
        <template v-if="dayList.length"
          ><PostsTable :posts="paginated" /><ListPagination
            v-model:page="page"
            v-model:page-size="pageSize"
            :total="total"
        /></template>
        <!-- A quiet day inside a month that has posts is not an empty calendar. -->
        <p
          v-else-if="view !== 'list' && visible.length"
          class="px-3 py-6 text-center text-sm text-muted"
        >
          {{ t('calendar.emptyDay') }}
        </p>
        <DashboardEmpty
          v-else
          icon="i-lucide-calendar-days"
          :title="t('calendar.emptyTitle')"
          :description="t('calendar.emptyDescription')"
          :actions="[{ label: t('nav.viewPosts'), to: `${base}/content` }]"
        />
      </div>
    </UCard>
  </DashboardPage>
</template>
