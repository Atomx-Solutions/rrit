<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })
const { context } = useWorkspace()
const { t } = useI18n()
const route = useRoute()
const { showError, showSuccess } = useFormFeedback()

const MAX_PHOTOS = 3
const MAX_SOURCE_BYTES = 5 * 1024 * 1024
const categories = ['bug', 'feature', 'improvement', 'other'] as const
const category = ref<(typeof categories)[number]>('bug')
const message = ref('')
const photos = ref<string[]>([])
const busy = ref(false)
const categoryItems = computed(() =>
  categories.map((value) => ({ value, label: t(`feedback.category.${value}`) })),
)

watch(open, (value) => {
  if (!value) return
  category.value = 'bug'
  message.value = ''
  photos.value = []
})

// The image is scaled and re-encoded here, so the server only ever stores a
// small JPEG without whatever metadata the original carried.
async function toJpeg(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > MAX_SOURCE_BYTES)
    throw new Error(t('feedback.photoInvalid'))
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', 0.8)
}

const picked = ref<File[] | null>(null)
watch(picked, (files) => {
  if (files?.length) void addPhotos(files)
})
async function addPhotos(selected: File[]) {
  const files = selected.slice(0, MAX_PHOTOS - photos.value.length)
  picked.value = null
  try {
    for (const file of files) photos.value.push(await toJpeg(file))
  } catch (problem) {
    showError(problem instanceof Error ? problem.message : t('feedback.photoInvalid'))
  }
}

async function submit() {
  if (!context.value || busy.value || message.value.trim().length < 3) return
  busy.value = true
  try {
    await $fetch('/api/feedback', {
      method: 'POST',
      body: {
        organizationId: context.value.id,
        category: category.value,
        pageUrl: route.fullPath,
        message: message.value,
        photos: photos.value,
      },
    })
    showSuccess(t('feedback.sent'))
    open.value = false
  } catch (problem) {
    const key = (problem as { data?: { message?: string } }).data?.message
    showError(key?.startsWith('server.') ? t(key) : t('server.FEEDBACK_INVALID'))
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <UModal
    v-model:open="open"
    :dismissible="!busy"
    :close="!busy"
    :title="t('feedback.title')"
    :description="t('feedback.description')"
  >
    <template #body>
      <UForm :state="{ category, message }" class="space-y-4" @submit="submit">
        <UFormField :label="t('feedback.category')">
          <USelect v-model="category" :items="categoryItems" class="w-full" :disabled="busy" />
        </UFormField>
        <UFormField :label="t('feedback.message')" required>
          <UTextarea
            v-model="message"
            :placeholder="t('feedback.messagePlaceholder')"
            :rows="5"
            :maxlength="4000"
            autoresize
            class="w-full"
            :disabled="busy"
          />
        </UFormField>
        <UFormField :label="t('feedback.photos')" :description="t('feedback.photosHint')">
          <!-- Equal square cells, so the upload tile can never grow past the
               photos and spill over the buttons below on a narrow screen. -->
          <div class="grid grid-cols-4 gap-3 pt-2">
            <div v-for="(photo, index) in photos" :key="index" class="relative aspect-square">
              <img :src="photo" alt="" class="size-full rounded-md object-cover" >
              <UButton
                icon="i-lucide-x"
                size="xs"
                color="neutral"
                class="absolute -right-2 -top-2 rounded-full"
                :aria-label="t('feedback.removePhoto')"
                :disabled="busy"
                @click="photos.splice(index, 1)"
              />
            </div>
            <UFileUpload
              v-if="photos.length < MAX_PHOTOS"
              v-model="picked"
              multiple
              accept="image/jpeg,image/png,image/webp"
              icon="i-lucide-image-plus"
              :preview="false"
              :disabled="busy"
              :aria-label="t('feedback.addPhoto')"
              class="aspect-square"
              :ui="{ root: 'size-full', base: 'size-full min-h-0 p-0' }"
            />
          </div>
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="busy" @click="open = false">
            {{ t('feedback.cancel') }}
          </UButton>
          <UButton type="submit" icon="i-lucide-send" :loading="busy" :disabled="message.trim().length < 3">
            {{ t('feedback.submit') }}
          </UButton>
        </div>
      </UForm>
    </template>
  </UModal>
</template>
