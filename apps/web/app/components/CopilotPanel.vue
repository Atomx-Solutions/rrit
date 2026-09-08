<script setup lang="ts">
const emit = defineEmits<{ navigate: [] }>()
const { base } = useWorkspace()
const suggestions = [
  {
    title: '1. Plotëso biznesin',
    description: 'Emri, produktet, orari dhe faktet që klientët duhet t’i dinë.',
    path: 'brand',
    icon: 'i-lucide-store',
  },
  {
    title: '2. Lidh rrjetet — opsionale',
    description: 'Zgjidh faqen përmes Meta për ta lexuar historikun, ose vazhdo pa lidhje.',
    path: 'social-posts',
    icon: 'i-lucide-link',
  },
  {
    title: '3. Përgatit një postim',
    description: 'Ngarko fotografinë, shkruaj tekstin dhe shiko parapamjen.',
    path: 'content/new',
    icon: 'i-lucide-square-pen',
  },
  {
    title: '4. Kontrollo dhe mirato',
    description: 'Rishiko faktet dhe fotografinë. Vetëm ti vendos çfarë publikohet.',
    path: 'content?status=review',
    icon: 'i-lucide-check-check',
  },
  {
    title: '5. Mbaj në sy orarin',
    description: 'Shiko postimet e planifikuara dhe gjendjen e tyre.',
    path: 'calendar',
    icon: 'i-lucide-calendar-days',
  },
]
</script>
<template>
  <div class="space-y-4">
    <p class="text-sm text-muted">
      Fillo nga hapi që të duhet. Mund të kthehesh te ky udhëzim në çdo kohë.
    </p>
    <UPageCard
      v-for="item in suggestions"
      :key="item.path"
      :to="base + '/' + item.path"
      :title="item.title"
      :description="item.description"
      :icon="item.icon"
      variant="outline"
      :ui="{ container: 'p-5', title: 'text-sm', description: 'text-sm leading-relaxed' }"
      @click="emit('navigate')"
    /><UButton to="/help" target="_blank" variant="link" color="neutral"
      >Lexo të gjitha udhëzimet</UButton
    >
  </div>
</template>
