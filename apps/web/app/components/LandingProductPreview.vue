<script setup lang="ts">
const steps = [
  {
    icon: 'i-lucide-image-plus',
    title: 'Fotografia jote',
    description: 'Ngarko materialet e biznesit dhe mbaji bashkë.',
  },
  {
    icon: 'i-lucide-text-cursor-input',
    title: 'Mesazhi yt',
    description: 'Shkruaj, ruaj dhe shiko pamjen për secilin rrjet.',
  },
  {
    icon: 'i-lucide-check-check',
    title: 'Miratimi yt',
    description: 'Kontrollo faktet përpara se të zgjedhësh publikimin.',
  },
]
</script>
<template>
  <UCard class="max-w-4xl mx-auto text-left shadow-sm" :ui="{ body: 'p-0 sm:p-0' }">
    <div class="flex items-center justify-between border-b border-default px-5 py-4">
      <BrandLogo /><span class="text-xs text-muted">Nga ideja te postimi</span>
    </div>
    <div class="divide-y divide-default">
      <div
        v-for="(step, index) in steps"
        :key="step.title"
        class="flex items-center gap-5 px-5 py-6 sm:px-8"
      >
        <span class="text-xs text-muted tabular-nums">{{ String(index + 1).padStart(2, '0') }}</span
        ><UAvatar :icon="step.icon" :ui="{ root: 'bg-elevated text-default rounded-lg' }" />
        <div class="flex-1">
          <h2 class="text-sm font-semibold">{{ step.title }}</h2>
          <p class="text-sm text-muted mt-1">{{ step.description }}</p>
        </div>
        <UIcon name="i-lucide-arrow-right" class="size-4 text-muted hidden sm:block" />
      </div>
    </div>
    <div
      class="flex flex-wrap items-center justify-between gap-3 border-t border-default px-5 py-4"
    >
      <span class="text-xs text-muted">Facebook dhe Instagram · Një hapësirë e biznesit</span
      ><UButton to="/signup" variant="outline" color="neutral" size="sm"
        >Krijo llogarinë tënde</UButton
      >
    </div>
  </UCard>
</template>
