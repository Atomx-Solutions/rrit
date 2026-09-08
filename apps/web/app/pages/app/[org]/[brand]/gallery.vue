<script setup lang="ts">
import type { Asset } from '~~/shared/schemas/workspace'
definePageMeta({ layout: 'dashboard', middleware: 'workspace' })
useSeoMeta({ title: 'Galeria · Rrit' })
const { data, commit, notify, initLive } = useWorkspace()
const query = ref('')
const selected = ref<string[]>([])
const detail = ref<Asset | null>(null)
const deleteOpen = ref(false)
const uploading = ref(false)
const progress = ref(0)
const error = ref('')
const rights = ref(false)
const uploadOpen = ref(false)
const tags = ref('')
const rightsOpen = ref(false)
const rightsBusy = ref(false)
const rightsError = ref('')
const selectedFiles = ref<File[]>([])
function openDetail(asset: Asset) {
  detail.value = asset
  tags.value = asset.tags.join(', ')
}
const assets = computed(() =>
  data.value.assets.filter((a) =>
    `${a.name} ${a.tags.join(' ')}`
      .toLocaleLowerCase('sq')
      .includes(query.value.trim().toLocaleLowerCase('sq')),
  ),
)
const { page, pageSize, total, paginated } = usePagination(assets)
watch(query, () => {
  page.value = 1
})
const dependencies = computed(() =>
  data.value.posts.filter((p) =>
    data.value.assets.some((a) => selected.value.includes(a.id) && a.url === p.image),
  ),
)
function toggle(id: string) {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((x) => x !== id)
    : [...selected.value, id]
}
watch(query, () => {
  selected.value = []
})
function openUpload() {
  rights.value = false
  selectedFiles.value = []
  error.value = ''
  uploadOpen.value = true
}
async function withdrawRights() {
  if (!detail.value || rightsBusy.value) return
  rightsBusy.value = true
  rightsError.value = ''
  try {
    const result = await $fetch(`/api/media/${detail.value.id}/rights`, {
      method: 'POST',
      body: { rights: false, confirmed: true },
      retry: 0,
    })
    await initLive()
    rightsOpen.value = false
    detail.value = null
    notify(
      result.inFlight
        ? 'Të drejtat u tërhoqën; një publikim në proces kërkon verifikim'
        : 'Të drejtat u tërhoqën dhe përdorimi i ardhshëm u bllokua',
    )
  } catch (problem) {
    rightsError.value =
      (problem as { data?: { message?: string } }).data?.message ||
      'Tërheqja e të drejtave nuk u përfundua.'
  } finally {
    rightsBusy.value = false
  }
}
async function upload(files: File[] | null | undefined) {
  if (!files?.length || uploading.value) return
  error.value = ''
  if (!rights.value) {
    error.value = 'Konfirmo të drejtat para se të ngarkosh.'
    return
  }
  if (files.length > 8) {
    error.value = 'Ngarko deri në 8 fotografi njëherësh.'
    return
  }
  uploading.value = true
  progress.value = 0
  try {
    const added: Asset[] = []
    for (const [i, file] of files.entries()) {
      if (
        !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
        file.size > 5 * 1024 * 1024
      )
        throw new Error('Pranohen JPG, PNG dhe WebP deri në 5 MB. SVG nuk pranohet.')
      const bitmap = await createImageBitmap(file)
      if (bitmap.width < 100 || bitmap.height < 100) {
        bitmap.close()
        throw new Error('Fotografia duhet të jetë të paktën 100 × 100 pikselë.')
      }
      const ratio = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(bitmap.width * ratio)
      canvas.height = Math.round(bitmap.height * ratio)
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      bitmap.close()
      const url = canvas.toDataURL('image/jpeg', 0.8)
      added.push({
        id: crypto.randomUUID(),
        name: file.name,
        url,
        tags: ['ngarkim'],
        rights: true,
        kind: 'photo',
        size: file.size,
      })
      progress.value = Math.round(((i + 1) / files.length) * 100)
    }
    if (await commit((d) => d.assets.unshift(...added))) {
      notify(`${added.length} fotografi u ruajtën`)
      uploadOpen.value = false
      selectedFiles.value = []
    } else {
      error.value = 'Fotografitë nuk u ruajtën. Kontrollo njoftimin e ruajtjes dhe provo sërish.'
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Ngarkimi dështoi. Provo sërish.'
  } finally {
    uploading.value = false
  }
}
async function remove() {
  if (dependencies.value.length) return
  if (await commit((d) => (d.assets = d.assets.filter((a) => !selected.value.includes(a.id))))) {
    selected.value = []
    deleteOpen.value = false
    notify('Fotografitë u hoqën')
  }
}
async function saveMetadata() {
  if (!detail.value) return
  const id = detail.value.id
  if (
    await commit((d) => {
      const a = d.assets.find((a) => a.id === id)!
      a.tags = tags.value
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    })
  ) {
    detail.value = null
    notify()
  }
}
</script>
<template>
  <DashboardPage
    title="Galeria"
    description="Fotografitë e produkteve, ambientit dhe momenteve të biznesit tënd."
  >
    <template #actions
      ><UButton variant="outline" icon="i-lucide-upload" @click="openUpload"
        >Ngarko fotografi</UButton
      ></template
    >
    <template #toolbar>
      <div class="flex w-full flex-wrap items-center justify-between gap-3">
        <UInput
          v-model="query"
          placeholder="Kërko emër ose etiketë..."
          aria-label="Kërko në galeri"
          icon="i-lucide-search"
          class="w-full sm:w-80"
        />
        <div class="actions">
          <span role="status" class="text-sm text-muted">{{ assets.length }} fotografi</span
          ><UButton
            v-if="selected.length"
            color="neutral"
            variant="ghost"
            size="sm"
            @click="selected = []"
            >Anulo përzgjedhjen</UButton
          ><UButton
            v-if="selected.length"
            color="error"
            variant="outline"
            icon="i-lucide-trash-2"
            @click="deleteOpen = true"
            >Hiq {{ selected.length }}</UButton
          >
        </div>
      </div>
    </template>
    <UCard v-if="assets.length" :ui="{ body: 'p-0 sm:p-0' }">
      <div class="divide-y divide-default">
        <article
          v-for="asset in paginated"
          :key="asset.id"
          class="flex items-center gap-3 sm:gap-4 p-4 sm:p-5"
        >
          <UCheckbox
            :model-value="selected.includes(asset.id)"
            :aria-label="`Përzgjidh ${asset.name}`"
            @update:model-value="toggle(asset.id)"
          />
          <UButton
            variant="ghost"
            color="neutral"
            class="p-0 size-14 sm:size-16 shrink-0 overflow-hidden rounded-md"
            :aria-label="`Detajet e ${asset.name}`"
            @click="openDetail(asset)"
          >
            <MediaImage
              :src="asset.url"
              :alt="asset.name"
              class="size-full"
              width="64"
              height="64"
            />
          </UButton>
          <div class="min-w-0 flex-1">
            <h3 class="text-sm font-medium break-words">{{ asset.name }}</h3>
            <div v-if="asset.tags.length" class="flex flex-wrap gap-1.5 mt-2">
              <UBadge
                v-for="tag in asset.tags"
                :key="tag"
                color="neutral"
                variant="outline"
                size="sm"
                >{{ tag }}</UBadge
              >
            </div>
            <p class="text-xs text-muted mt-2 flex items-center gap-1.5">
              <UIcon
                :name="asset.rights ? 'i-lucide-shield-check' : 'i-lucide-shield-alert'"
                class="size-3.5 shrink-0"
              />{{ asset.rights ? 'Të drejtat të konfirmuara' : 'Kërkohet konfirmim' }}
            </p>
          </div>
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-arrow-up-right"
            :aria-label="`Hap fotografinë: ${asset.name}`"
            @click="openDetail(asset)"
          />
        </article>
      </div>
      <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" />
    </UCard>
    <DashboardEmpty
      v-if="!assets.length"
      :title="query.trim() ? 'Nuk u gjet asnjë fotografi' : 'Hapësirë për historinë tënde'"
      :description="
        query.trim()
          ? 'Provo një emër tjetër ose shiko të gjithë galerinë.'
          : 'Shto fotografitë e tua për t’i përdorur në postime.'
      "
      icon="i-lucide-images"
      :actions="
        query.trim()
          ? [{ label: 'Pastro kërkimin', onClick: () => (query = '') }]
          : [{ label: 'Shto fotografi', onClick: openUpload }]
      "
    />
    <UModal
      v-model:open="uploadOpen"
      :dismissible="!uploading"
      :close="!uploading"
      title="Shto fotografi në galeri"
      :description="'Fotografitë ruhen privatisht në llogarinë e biznesit.'"
      ><template #body
        ><div class="stack">
          <UCheckbox
            v-model="rights"
            :disabled="uploading"
            label="Kam të drejtën t’i përdor këto fotografi dhe pëlqimin e personave të identifikueshëm."
          /><UFileUpload
            v-model="selectedFiles"
            multiple
            accept="image/jpeg,image/png,image/webp"
            :disabled="!rights || uploading"
            label="Zgjidh fotografitë ose tërhiqi këtu"
            description="JPG, PNG, WebP deri 5 MB secila. Deri në 8 fotografi."
            icon="i-lucide-cloud-upload"
            :interactive="true"
            class="min-h-48"
            @update:model-value="upload"
          /><UProgress v-if="uploading" :model-value="progress" aria-label="Progresi i ngarkimit" />
          <p v-if="error" role="alert" class="field-error">{{ error }}</p>
          <UButton
            v-if="error && selectedFiles.length"
            variant="outline"
            :disabled="!rights"
            :loading="uploading"
            @click="upload(selectedFiles)"
            >Provo ngarkimin sërish</UButton
          >
          <p class="small muted">
            Ruajmë një kopje të përshtatur për postime, deri në 1 200 pikselë. Mbaji edhe
            origjinalet e tua.
          </p>
        </div></template
      ></UModal
    >
    <USlideover
      :open="!!detail"
      :title="detail?.name"
      description="Etiketat dhe të drejtat e përdorimit"
      @update:open="detail = $event ? detail : null"
      ><template #body
        ><div v-if="detail" class="stack">
          <MediaImage
            :src="detail.url"
            :alt="detail.name"
            class="w-full aspect-[4/3] rounded-lg"
          /><UFormField label="Etiketat" name="tags" class="field"
            ><UInput v-model="tags" class="w-full" /><small>Ndaji me presje.</small></UFormField
          >
          <p class="small muted">
            {{
              detail.size
                ? `${Math.round(detail.size / 1024)} KB · ruajtur privatisht`
                : 'Fotografi e biznesit · ruajtur privatisht'
            }}
          </p>
          <UAlert
            :color="detail.rights ? 'neutral' : 'warning'"
            variant="outline"
            :title="
              detail.rights ? 'Të drejtat janë konfirmuar' : 'Të drejtat ende nuk janë konfirmuar'
            "
          /><div class="actions">
            <UButton variant="outline" @click="saveMetadata">Ruaj etiketat</UButton
            ><UButton
              v-if="detail.rights"
              color="error"
              variant="outline"
              @click="rightsOpen = true"
              >Tërhiq të drejtat</UButton
            >
          </div>
        </div></template
      ></USlideover
    >
    <UModal
      v-model:open="rightsOpen"
      title="Tërhiq të drejtat e fotografisë?"
      description="Fotografia nuk do të mund të përdoret në postime të reja. Postimet e papublikuara që varen prej saj kthehen në draft."
    >
      <template #body>
        <div class="stack">
          <UAlert v-if="rightsError" color="error" variant="outline" :title="rightsError" />
          <p class="text-sm text-muted">
            Publikimet tashmë të dërguara ose që presin konfirmim nga Meta nuk fshihen automatikisht.
          </p>
          <UButton color="error" variant="outline" :loading="rightsBusy" @click="withdrawRights"
            >Konfirmo tërheqjen</UButton
          >
        </div>
      </template>
    </UModal>
    <UModal
      v-model:open="deleteOpen"
      title="Hiq fotografitë e përzgjedhura?"
      description="Fotografitë e zgjedhura hiqen nga llogaria e biznesit. Fotografitë që përdoren në postime ruhen."
      ><template #body
        ><div class="stack">
          <UAlert
            v-if="dependencies.length"
            color="warning"
            title="Fotografitë përdoren në postime"
            :description="`${dependencies.length} postime përdorin këto fotografi. Ndrysho fotografinë e postimeve përpara heqjes.`"
          />
          <p v-else>{{ selected.length }} fotografi do të hiqen. Ky veprim nuk zhbëhet.</p>
          <UButton variant="outline" color="error" :disabled="!!dependencies.length" @click="remove"
            >Konfirmo heqjen</UButton
          >
        </div></template
      ></UModal
    >
  </DashboardPage>
</template>
