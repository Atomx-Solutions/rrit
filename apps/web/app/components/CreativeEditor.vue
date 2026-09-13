<script setup lang="ts">
import type { Post } from '~~/shared/schemas/workspace'

const props = defineProps<{ post: Post; disabled?: boolean }>()
const emit = defineEmits<{ saved: [image: string] }>()
const { applyBusiness } = useWorkspace()
const open = ref(false)
const busy = ref(false)
const error = ref('')
const aiInstruction = ref('')

watch(open, (value) => {
  if (value && props.post.aiProvenance) {
    aiInstruction.value = ''
    error.value = ''
  }
})

async function generateWithAi() {
  if (busy.value || props.disabled || aiInstruction.value.trim().length < 5) return
  busy.value = true
  error.value = ''
  try {
    const result = await $fetch(`/api/posts/${props.post.id}/creative`, {
      method: 'POST',
      body: {
        action: 'ai-edit',
        contentVersion: props.post.contentVersion || 1,
        instruction: aiInstruction.value,
      },
      retry: 0,
      timeout: 330000,
    })
    applyBusiness(result.business)
    emit('saved', result.image)
    open.value = false
  } catch (problem) {
    error.value =
      (problem as { data?: { message?: string } }).data?.message ||
      'Fotografia nuk u rigjenerua. Versioni aktual mbeti i paprekur.'
  } finally {
    busy.value = false
  }
}

</script>

<template>
  <UButton
    variant="outline"
    color="neutral"
    icon="i-lucide-sparkles"
    :disabled="disabled"
    @click="open = true"
    >Përmirëso me AI</UButton
  >
  <UModal
    v-model:open="open"
    title="Përmirëso dizajnin me AI"
    description="AI e redizajnon vetë fotografinë aktuale sipas udhëzimit tënd. Nuk përdoret asnjë layout ose template i koduar."
  >
    <template #body>
      <div class="space-y-6">
        <section class="rounded-xl border border-primary/20 bg-primary/5 p-4 sm:p-5">
          <div class="flex items-start gap-3">
            <div
              class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
            >
              <UIcon name="i-lucide-sparkles" class="size-4" />
            </div>
            <div>
              <h3 class="text-sm font-semibold">Ridizajnim origjinal me AI</h3>
              <p class="mt-1 text-xs leading-5 text-muted">
                AI pastron fotografinë, përmirëson cilësinë dhe krijon vetë kompozimin final duke
                ruajtur kontekstin e strategjisë, platformës dhe biznesit.
              </p>
            </div>
          </div>
          <UFormField label="Çfarë dëshiron të ndryshosh?" required class="mt-4">
            <UTextarea
              v-model="aiInstruction"
              :maxlength="1200"
              :rows="4"
              :disabled="busy"
              class="w-full"
              placeholder="P.sh. pastro fotografinë, ruaje lokalin real dhe krijo një kompozim elegant e origjinal për darkë, pa template, header ose footer standard."
            />
          </UFormField>
          <UButton
            class="mt-4"
            icon="i-lucide-sparkles"
            :loading="busy"
            :disabled="disabled || aiInstruction.trim().length < 5"
            @click="generateWithAi"
            >Krijo variantin me AI</UButton
          >
          <p class="mt-3 text-xs leading-5 text-muted">
            Përdor një kërkesë AI nga paketa. Postimi nuk miratohet ose publikohet automatikisht.
          </p>
        </section>

        <UAlert v-if="error" color="error" variant="outline" :title="error" />
      </div>
    </template>
  </UModal>
</template>
