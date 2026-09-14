<script setup lang="ts">
defineProps<{
  open: boolean
  saving?: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  save: []
  discard: []
}>()
</script>

<template>
  <UModal
    :open="open"
    class="sm:max-w-xl"
    title="Ke ndryshime të paruajtura"
    description="Ruaji para se të largohesh ose vazhdo pa i ruajtur ndryshimet e fundit."
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="flex flex-wrap items-center gap-3 sm:gap-4">
        <UButton variant="outline" :loading="saving" @click="emit('save')">
          Ruaj dhe vazhdo
        </UButton>
        <UButton color="error" variant="outline" @click="emit('discard')">
          Largohu pa ruajtur
        </UButton>
        <UButton color="neutral" variant="ghost" @click="emit('update:open', false)">
          Qëndro këtu
        </UButton>
      </div>
    </template>
  </UModal>
</template>
