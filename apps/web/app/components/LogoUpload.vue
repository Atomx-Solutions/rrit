<script setup lang="ts">
import type { Asset } from '~~/shared/schemas/workspace'

const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })
const { data, commit, notify } = useWorkspace()
const { t } = useI18n()
const { watchError } = useFormFeedback()

const open = ref(false)
const rights = ref(false)
const file = ref<File | null>(null)
const filePreviewUrl = ref<string | null>(null)
const previewOpen = ref(false)
const busy = ref(false)
const error = ref('')
watchError(error)

const currentLogo = computed(() => data.value.assets.find((asset) => asset.kind === 'brand'))

watch(file, (value) => {
  if (filePreviewUrl.value) URL.revokeObjectURL(filePreviewUrl.value)
  filePreviewUrl.value = value ? URL.createObjectURL(value) : null
})

onBeforeUnmount(() => {
  if (filePreviewUrl.value) URL.revokeObjectURL(filePreviewUrl.value)
})

function start() {
  rights.value = false
  file.value = null
  error.value = ''
  open.value = true
}

async function upload(value: File | null | undefined) {
  if (!value || !rights.value || busy.value) return
  error.value = ''
  busy.value = true
  try {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(value.type) || value.size > 5 * 1024 * 1024)
      throw new Error(t('logo.invalidFormat'))

    const bitmap = await createImageBitmap(value)
    if (bitmap.width < 100 || bitmap.height < 100) {
      bitmap.close()
      throw new Error(t('logo.tooSmall'))
    }
    const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const context = canvas.getContext('2d')!
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()

    const asset: Asset = {
      id: crypto.randomUUID(),
      name: value.name,
      url: canvas.toDataURL('image/png'),
      tags: ['logo'],
      rights: true,
      kind: 'brand',
      size: value.size,
    }
    if (!(await commit((draft) => {
      draft.assets = [asset, ...draft.assets.filter((item) => item.kind !== 'brand')]
    }))) {
      error.value = t('logo.saveError')
      return
    }
    notify(t('logo.saved'))
    open.value = false
  } catch (problem) {
    error.value = problem instanceof Error ? problem.message : t('logo.uploadError')
  } finally {
    busy.value = false
  }
}

watch(rights, (confirmed) => {
  if (confirmed && file.value) void upload(file.value)
})
</script>

<template>
  <UCard
    v-if="!props.compact"
    :ui="{ header: 'flex flex-wrap items-start justify-between gap-3', body: 'flex flex-wrap items-center gap-3' }"
  >
    <template #header>
      <UUser
        :name="t('logo.title')"
        :description="t('logo.description')"
        :avatar="{ icon: 'i-lucide-image' }"
      />
      <UBadge v-if="currentLogo" color="success" variant="subtle">{{ t('logo.uploaded') }}</UBadge>
    </template>
    <template v-if="currentLogo">
      <UUser
        :name="currentLogo.name"
        :description="t('logo.usedForGeneration')"
        :avatar="{ src: currentLogo.url, alt: currentLogo.name }"
        class="min-w-0 flex-1"
      />
      <UButton type="button" size="sm" variant="outline" @click="start">{{ t('logo.replace') }}</UButton>
    </template>
    <UButton v-else type="button" variant="outline" icon="i-lucide-image-plus" @click="start">{{ t('logo.upload') }}</UButton>
  </UCard>
  <UButton
    v-else
    v-bind="$attrs"
    type="button"
    variant="outline"
    icon="i-lucide-image-plus"
    class="whitespace-nowrap"
    @click="start"
  >
    {{ currentLogo ? t('logo.replace') : t('logo.upload') }}
  </UButton>

  <UModal
    v-model:open="open"
    :dismissible="false"
    :close="true"
    :title="t('logo.modalTitle')"
    :description="t('logo.modalDescription')"
    :ui="{
      close: 'size-9 rounded-full border border-default bg-elevated text-muted shadow-sm hover:bg-muted hover:text-highlighted focus-visible:ring-2 focus-visible:ring-primary',
    }"
  >
    <template #body>
      <div class="space-y-5">
        <div
          v-if="file"
          class="relative flex min-h-40 items-center justify-center overflow-hidden rounded-lg border border-default bg-elevated"
        >
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            class="flex min-h-40 w-full cursor-zoom-in items-center justify-center p-3"
            :aria-label="file.name"
            @click="previewOpen = true"
          >
            <img
              v-if="filePreviewUrl"
              :src="filePreviewUrl"
              :alt="file.name"
              class="max-h-48 max-w-full rounded-md object-contain"
            />
          </UButton>
          <UButton
            type="button"
            color="neutral"
            variant="outline"
            icon="i-lucide-x"
            :aria-label="t('common.remove')"
            :disabled="busy"
            class="absolute right-2 top-2 size-10 justify-center rounded-full bg-default p-0 shadow-md"
            @click.stop="file = null; error = ''"
          />
        </div>
        <UFileUpload
          v-else
          v-model="file"
          :disabled="busy"
          accept="image/jpeg,image/png,image/webp"
          :label="t('logo.choose')"
          :description="t('logo.formats')"
          class="min-h-40"
          :interactive="true"
          @update:model-value="upload"
        />
        <UCheckbox v-model="rights" :disabled="busy" :label="t('logo.rightsLabel')" />
        <UProgress v-if="busy" :aria-label="t('logo.saving')" />
        <UButton
          v-if="error && file"
          type="button"
          variant="outline"
          :loading="busy"
          :disabled="!rights"
          @click="upload(file)"
        >
          {{ t('common.tryAgain') }}
        </UButton>
      </div>
    </template>
  </UModal>

  <UModal
    v-model:open="previewOpen"
    :dismissible="false"
    :title="file?.name || t('logo.title')"
    :ui="{ content: 'sm:max-w-4xl' }"
  >
    <template #body>
      <div class="flex max-h-[75dvh] items-center justify-center">
        <img
          v-if="filePreviewUrl"
          :src="filePreviewUrl"
          :alt="file?.name || t('logo.title')"
          class="max-h-[75dvh] max-w-full rounded-lg object-contain"
        />
      </div>
    </template>
  </UModal>
</template>
