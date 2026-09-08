<script setup lang="ts">
import type { Asset } from '~~/shared/schemas/workspace'
const { data, commit, notify } = useWorkspace()
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
      throw new Error('Zgjidh JPG, PNG ose WebP deri në 5 MB.')
    const bitmap = await createImageBitmap(value)
    if (bitmap.width < 100 || bitmap.height < 100) {
      bitmap.close()
      throw new Error('Fotografia duhet të jetë të paktën 100 × 100 pikselë.')
    }
    const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const asset: Asset = {
      id: crypto.randomUUID(),
      name: value.name,
      url: canvas.toDataURL('image/jpeg', 0.8),
      tags: [],
      rights: true,
      kind: 'photo',
      size: value.size,
    }
    if (
      !(await commit((d) => {
        d.assets.unshift(asset)
      }))
    ) {
      error.value = 'Fotografia nuk u ruajt. Provo sërish.'
      return
    }
    emit('uploaded', data.value.assets.find((a) => a.id === asset.id)!.url)
    notify('Fotografia u shtua')
    open.value = false
  } catch (problem) {
    error.value = problem instanceof Error ? problem.message : 'Ngarkimi dështoi.'
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
    >Shto fotografi</UButton
  >
  <UModal
    v-model:open="open"
    :dismissible="!busy"
    :close="!busy"
    title="Fotografia e postimit"
    description="Shto një fotografi pa u larguar nga postimi."
  >
    <template #body
      ><div class="space-y-5">
        <UCheckbox
          v-model="rights"
          :disabled="busy"
          label="Kam të drejtën ta përdor këtë fotografi dhe pëlqimin e personave të identifikueshëm."
        /><UFileUpload
          v-model="file"
          :disabled="!rights || busy"
          accept="image/jpeg,image/png,image/webp"
          label="Zgjidh fotografinë"
          description="JPG, PNG ose WebP deri në 5 MB."
          class="min-h-40"
          :interactive="true"
          @update:model-value="upload"
        /><UProgress v-if="busy" aria-label="Po ruhet fotografia" /><UAlert
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
          >Provo sërish</UButton
        >
      </div></template
    >
  </UModal>
</template>
