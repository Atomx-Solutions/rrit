<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'workspace' })
useSeoMeta({ title: 'Planifikimi me AI · Rrit' })

const { data, base } = useWorkspace()
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
    title="Planifikimi me AI"
    description="Nga hulumtimi i tregut deri te draftet e gatshme për miratimin tënd."
  >
    <template #actions>
      <div class="flex flex-wrap gap-2">
        <UButton :to="`${base}/content`" color="neutral" variant="outline" icon="i-lucide-files">
          Content Studio
        </UButton>
        <UButton :to="`${base}/calendar`" variant="outline" icon="i-lucide-calendar-days">
          Shiko kalendarin
        </UButton>
      </div>
    </template>

    <MonthlyPlannerPanel :month="month" />

    <UCard :ui="{ body: 'p-4' }">
      <div class="grid gap-4 md:grid-cols-3">
        <div class="flex items-start gap-3">
          <UIcon name="i-lucide-search" class="mt-0.5 size-4 shrink-0 text-primary" />
          <div>
            <h2 class="text-sm font-semibold">Hulumtim real</h2>
            <p class="mt-1 text-xs leading-5 text-muted">
              Tregu, audienca, platformat dhe burimet ruhen bashkë me planin.
            </p>
          </div>
        </div>
        <div class="flex items-start gap-3">
          <UIcon name="i-lucide-image" class="mt-0.5 size-4 shrink-0 text-primary" />
          <div>
            <h2 class="text-sm font-semibold">Strategji dhe dizajn</h2>
            <p class="mt-1 text-xs leading-5 text-muted">
              Çdo ide, tekst, fotografi, hashtag dhe orar ka arsyetimin e vet.
            </p>
          </div>
        </div>
        <div class="flex items-start gap-3">
          <UIcon name="i-lucide-shield-check" class="mt-0.5 size-4 shrink-0 text-primary" />
          <div>
            <h2 class="text-sm font-semibold">Ti vendos në fund</h2>
            <p class="mt-1 text-xs leading-5 text-muted">
              Asgjë nuk publikohet pa kontrollin dhe miratimin tënd në Content Studio.
            </p>
          </div>
        </div>
      </div>
    </UCard>
  </DashboardPage>
</template>
