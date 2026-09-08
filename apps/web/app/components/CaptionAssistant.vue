<script setup lang="ts">
const props = defineProps<{
  caption: string
  channel: 'Facebook' | 'Instagram'
  disabled?: boolean
}>()
const emit = defineEmits<{ apply: [caption: string] }>()
const { data: capabilities } = await useFetch('/api/capabilities')
const open = ref(false),
  busy = ref(false),
  idea = ref(''),
  error = ref('')
const result = ref<{ variants: { caption: string; note: string }[]; questions: string[] } | null>(
  null,
)
async function generate() {
  busy.value = true
  error.value = ''
  try {
    result.value = await $fetch('/api/ai/captions', {
      method: 'POST',
      body: {
        requestId: crypto.randomUUID(),
        idea: idea.value,
        caption: props.caption,
        channel: props.channel,
      },
      retry: 0,
      timeout: 55000,
    })
  } catch (problem) {
    error.value =
      (problem as { data?: { message?: string } }).data?.message || 'Përgatitja nuk u përfundua.'
  } finally {
    busy.value = false
  }
}
function apply(caption: string) {
  emit('apply', caption)
  open.value = false
}
</script>
<template>
  <UButton variant="outline" icon="i-lucide-sparkles" :disabled="disabled" @click="open = true"
    >Përgatit tekst me AI</UButton
  >
  <UModal
    v-model:open="open"
    title="Një ndihmë për tekstin"
    description="Profili, faktet e konfirmuara, teksti yt dhe disa postime të importuara dërgohen te OpenAI për këtë përgatitje."
  >
    <template #body
      ><div class="space-y-5">
        <UAlert
          v-if="!capabilities?.ai"
          color="neutral"
          variant="outline"
          title="Asistenti është në përgatitje"
          description="Platforma ende nuk e ka aktivizuar shërbimin AI. Mund të vazhdosh ta shkruash tekstin vetë."
        />
        <UForm v-else :state="{ idea }" class="space-y-4" @submit="generate"
          ><UFormField label="Çfarë dëshiron të thuash?" required
            ><UTextarea
              v-model="idea"
              :disabled="busy"
              :maxlength="1000"
              placeholder="Përshkruaj idenë me fjalët e tua…"
              class="w-full" /></UFormField
          ><UButton
            type="submit"
            variant="outline"
            :loading="busy"
            :disabled="idea.trim().length < 5"
            >Përgatit variante</UButton
          ></UForm
        >
        <UAlert v-if="error" color="error" variant="outline" :title="error" />
        <template v-if="result"
          ><UCard v-for="(variant, index) in result.variants" :key="index"
            ><p class="text-sm whitespace-pre-wrap">{{ variant.caption }}</p>
            <p class="text-xs text-muted mt-4">{{ variant.note }}</p>
            <UButton
              variant="outline"
              color="neutral"
              class="mt-4"
              :disabled="disabled"
              @click="apply(variant.caption)"
              >Përdor këtë tekst</UButton
            ></UCard
          >
          <ul v-if="result.questions.length" class="list-disc ps-5 space-y-2 text-sm text-muted">
            <li v-for="question in result.questions" :key="question">{{ question }}</li>
          </ul>
          <p class="text-xs text-muted">
            Kontrolloje tekstin para miratimit. Zgjedhja e një varianti e ruan si draft.
          </p></template
        >
      </div></template
    >
  </UModal>
</template>
