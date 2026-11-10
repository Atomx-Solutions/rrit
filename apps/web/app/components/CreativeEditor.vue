<script setup lang="ts">
import type { Post } from '~~/shared/schemas/workspace'

const props = defineProps<{ post: Post; disabled?: boolean }>()
const emit = defineEmits<{ saved: [image: string] }>()
const { data, initLive, notify } = useWorkspace()
const { t } = useI18n()
const open = ref(false)
const busy = ref(false)
const error = ref('')
const aiInstruction = ref('')
// The instruction of the last edit, so a failed edit can be asked for again.
const lastInstruction = ref('')
const { watchError } = useFormFeedback()
watchError(error)

type EditStatus = 'queued' | 'editing' | 'ready' | 'failed'
const editStatus = ref<EditStatus | null>(null)
const editInProgress = computed(() => editStatus.value === 'queued' || editStatus.value === 'editing')

watch(open, (value) => {
  if (value && props.post.aiProvenance) {
    aiInstruction.value = ''
    error.value = ''
  }
})

// The edit is made on the server after the request is answered, so its status
// is read again until it is ready or has failed, also after a reload.
let timer: ReturnType<typeof setInterval> | undefined
function stopFollowing() {
  clearInterval(timer)
  timer = undefined
}
async function readEdit() {
  try {
    const result = await $fetch(`/api/posts/${props.post.id}/creative`)
    const previous = editStatus.value
    editStatus.value = result.edit?.status || null
    if (editInProgress.value) return follow()
    stopFollowing()
    if (!previous || previous === editStatus.value) return
    if (editStatus.value === 'ready') {
      await initLive()
      const image = data.value.posts.find((post) => post.id === props.post.id)?.image
      if (image) emit('saved', image)
      notify(t('creative.ready'))
    } else if (editStatus.value === 'failed') {
      error.value = t(result.edit?.failureReason || 'creative.error')
    }
  } catch {
    /* The edit's status is read again on the next tick. */
  }
}
function follow() {
  if (timer) return
  timer = setInterval(() => {
    if (!document.hidden) void readEdit()
  }, videoFollowMs)
}
onMounted(readEdit)
onBeforeUnmount(stopFollowing)

async function queueEdit(instruction: string) {
  if (busy.value || props.disabled || editInProgress.value || instruction.trim().length < 5) return
  busy.value = true
  error.value = ''
  try {
    const queued = await $fetch(`/api/posts/${props.post.id}/creative`, {
      method: 'POST',
      body: {
        action: 'ai-edit',
        contentVersion: props.post.contentVersion || 1,
        instruction,
      },
      retry: 0,
    })
    lastInstruction.value = instruction
    editStatus.value = queued.status
    open.value = false
    notify(t('creative.queued'))
    follow()
  } catch (problem) {
    error.value = t(
      (problem as { data?: { message?: string } }).data?.message || 'creative.error')
  } finally {
    busy.value = false
  }
}

function generateWithAi() {
  return queueEdit(aiInstruction.value)
}

// A failed edit is asked for again as it was; after a reload the instruction
// is no longer known, so it is written again.
function retryEdit() {
  if (lastInstruction.value) return queueEdit(lastInstruction.value)
  open.value = true
}

</script>

<template>
  <UButton
    v-if="editStatus === 'failed'"
    variant="outline"
    color="error"
    icon="i-lucide-rotate-ccw"
    :loading="busy"
    :disabled="disabled"
    @click="retryEdit"
    >{{ t('creative.tryAgain') }}</UButton
  >
  <UButton
    variant="outline"
    color="neutral"
    icon="i-lucide-sparkles"
    :loading="editInProgress"
    :disabled="disabled || editInProgress"
    @click="open = true"
    >{{ editInProgress ? t(editStatus === 'queued' ? 'creative.queued' : 'creative.editing') : t('creative.improveWithAi') }}</UButton
  >
  <UModal
    v-model:open="open"
    :title="t('creative.title')"
    :description="t('creative.description')"
    :dismissible="false"
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
              <h3 class="text-sm font-semibold">{{ t('creative.originalTitle') }}</h3>
              <p class="mt-1 text-xs leading-5 text-muted">
                {{ t('creative.originalDescription') }}
              </p>
            </div>
          </div>
          <UFormField :label="t('creative.instructionLabel')" required class="mt-4">
            <UTextarea
              v-model="aiInstruction"
              :maxlength="1200"
              :rows="4"
              :disabled="busy"
              class="w-full"
              :placeholder="t('creative.instructionPlaceholder')"
            />
          </UFormField>
          <UButton
            class="mt-4"
            icon="i-lucide-sparkles"
            :loading="busy"
            :disabled="disabled || aiInstruction.trim().length < 5"
            @click="generateWithAi"
            >{{ t('creative.createVariant') }}</UButton
          >
          <p class="mt-3 text-xs leading-5 text-muted">
            {{ t('creative.note') }}
          </p>
        </section>

      </div>
    </template>
  </UModal>
</template>
