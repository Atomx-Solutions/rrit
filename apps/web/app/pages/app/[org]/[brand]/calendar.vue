<script setup lang="ts">
import {
  calendarPeriod,
  dayInZone,
  moveCalendar,
  type CalendarView,
} from '~~/shared/utils/calendar'
definePageMeta({ layout: 'dashboard', middleware: 'workspace' })
useSeoMeta({ title: 'Kalendari · Rrit' })
const { data, base } = useWorkspace()
const today = computed(() => dayInZone(new Date(), data.value.preferences.timezone))
const anchor = ref(today.value)
const view = ref<CalendarView>('list')
const period = computed(() => calendarPeriod(anchor.value, view.value))
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
const { page, pageSize, total, paginated } = usePagination(visible)
watch([anchor, view], () => {
  page.value = 1
})
function move(direction: number) {
  anchor.value = moveCalendar(anchor.value, view.value, direction)
}
</script>
<template>
  <DashboardPage title="Kalendari" description="Shiko postimet e planifikuara dhe orarin e tyre.">
    <template #actions
      ><div class="flex flex-wrap gap-2">
        <UButton :to="`${base}/monthly-planner`" variant="outline" icon="i-lucide-sparkles">
          Planifiko me AI
        </UButton>
        <UButton :to="`${base}/content/new`" color="neutral" variant="outline" icon="i-lucide-plus">
          Krijo postim
        </UButton>
      </div></template
    >
    <template #toolbar>
      <div class="flex w-full flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <UButton
            icon="i-lucide-chevron-left"
            :aria-label="view === 'week' ? 'Java e mëparshme' : 'Muaji i mëparshëm'"
            color="neutral"
            variant="ghost"
            @click="move(-1)"
          />
          <h2 class="text-sm font-medium capitalize" aria-live="polite">{{ period.title }}</h2>
          <UButton
            icon="i-lucide-chevron-right"
            :aria-label="view === 'week' ? 'Java e ardhshme' : 'Muaji i ardhshëm'"
            color="neutral"
            variant="ghost"
            @click="move(1)"
          />
          <UButton color="neutral" variant="outline" size="sm" @click="anchor = today">Sot</UButton>
        </div>
        <UTabs
          v-model="view"
          :items="[
            { label: 'Muaj', value: 'month', icon: 'i-lucide-calendar-days' },
            { label: 'Javë', value: 'week', icon: 'i-lucide-calendar-range' },
            { label: 'Listë', value: 'list', icon: 'i-lucide-list' },
          ]"
          :content="false"
          variant="link"
          size="sm"
          aria-label="Pamja e kalendarit"
        />
      </div>
    </template>
    <p class="text-xs leading-5 text-muted">
      Planifiko pa lidhur Meta. Vetëm postimet ku ke zgjedhur publikimin automatik dërgohen në
      rrjete sociale.
    </p>
    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div
        class="flex flex-wrap justify-between gap-2 px-3 py-2 border-b border-default text-[11px] text-muted"
      >
        <span>{{ visible.length }} postime në këtë {{ view === 'week' ? 'javë' : 'muaj' }}</span
        ><span>Orari lokal i biznesit · {{ data.preferences.timezone }}</span>
      </div>
      <div v-if="view !== 'list'" class="hidden md:block">
        <div class="grid grid-cols-7">
          <div
            v-for="day in ['Hënë', 'Martë', 'Mërkurë', 'Enjte', 'Premte', 'Shtunë', 'Diel']"
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
              :aria-label="`Hap postimin: ${post.title}`"
              ><span class="flex items-center gap-1.5 text-muted mb-1"
                ><UIcon
                  :name="post.channel === 'Instagram' ? 'i-lucide-instagram' : 'i-lucide-facebook'"
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
                  ? 'Propozim · pret miratim'
                  : post.publicationMode === 'automatic'
                    ? 'Publikim automatik'
                    : 'Vetëm në kalendar'
              }}</span></ULink
            >
          </div>
        </div>
      </div>
      <div :class="view !== 'list' ? 'md:hidden' : ''">
        <template v-if="visible.length"
          ><PostsTable :posts="paginated" /><ListPagination
            v-model:page="page"
            v-model:page-size="pageSize"
            :total="total"
        /></template>
        <DashboardEmpty
          v-else
          icon="i-lucide-calendar-days"
          title="Nuk ka postime në këtë periudhë"
          description="Pasi ta miratosh një postim, zgjidh ditën dhe orën për ta shtuar këtu."
          :actions="[{ label: 'Shiko postimet', to: `${base}/content` }]"
        />
      </div>
    </UCard>
  </DashboardPage>
</template>
