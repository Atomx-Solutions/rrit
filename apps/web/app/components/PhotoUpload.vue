<script setup lang="ts">
const { uploadAsset, notify } = useWorkspace()
const { t } = useI18n()
const emit = defineEmits<{ uploaded: [url: string] }>()
const open = ref(false)
const rights = ref(false)
const error = ref('')
const busy = ref(false)
const file = ref<File | null>(null)
async function upload(value: File | null | undefined) {
  if (!value || !rights.value || busy.value) return
  error.value = ''
  busy.value = true
  try {
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(value.type) ||
      value.size > 5 * 1024 * 1024
    )
      throw new Error(t('photo.invalidType'))
    const bitmap = await createImageBitmap(value)
    if (bitmap.width < 100 || bitmap.height < 100) {
      bitmap.close()
      throw new Error(t('photo.tooSmall'))
    }
    bitmap.close()
    const asset = await uploadAsset(value, { name: value.name, tags: [], rights: true })
    if (!asset) {
      error.value = t('photo.saveError')
      return
    }
    emit('uploaded', asset.url)
    notify(t('photo.added'))
    open.value = false
  } catch (problem) {
    error.value = problem instanceof Error ? problem.message : t('photo.uploadError')
  } finally {
    busy.value = false
  }
}
function start() {
  error.value = ''
  rights.value = false
  file.value = null
  open.value = true
}
</script>
<template>
  <UButton color="neutral" variant="outline" icon="i-lucide-upload" @click="start"
    >{{ t('photo.addPhoto') }}</UButton
  >
  <UModal
    v-model:open="open"
    :dismissible="!busy"
    :close="!busy"
    :title="t('photo.title')"
    :description="t('photo.description')"
  >
    <template #body
      ><div class="space-y-5">
        <UCheckbox
          v-model="rights"
          :disabled="busy"
          :label="t('photo.rightsLabel')"
        /><UFileUpload
          v-model="file"
          :disabled="!rights || busy"
          accept="image/jpeg,image/png,image/webp"
          :label="t('photo.choosePhoto')"
          :description="t('photo.formats')"
          class="min-h-40"
          :interactive="true"
          @update:model-value="upload"
        /><UProgress v-if="busy" :aria-label="t('photo.saving')" /><UAlert
          v-if="error"
          color="error"
          variant="outline"
          :title="error"
        /><UButton
          v-if="error && file"
          variant="outline"
          :loading="busy"
          :disabled="!rights"
          @click="upload(file)"
          >{{ t('common.tryAgain') }}</UButton
        >
      </div></template
    >
  </UModal>
</template>
