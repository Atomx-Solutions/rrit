<script setup lang="ts">
import { musicMoodName, type MusicMood } from '~~/shared/schemas/music'
import { APP_LOCALES } from '~~/shared/schemas/workspace'

definePageMeta({ layout: 'admin', middleware: 'superadmin' })
const { t, language } = useI18n()
const { showError, showSuccess } = useFormFeedback()
useSeoMeta({
  title: () => `${t('admin.nav.music')} · Framic Admin`,
  robots: 'noindex, nofollow',
})

type Track = {
  id: string
  title: string
  artist: string | null
  mood: string
  duration_seconds: number
  active: boolean
  created_at: string
}
type Mood = MusicMood & { track_count: number }

const { data, status, error, refresh } = await useFetch<{ tracks: Track[]; moods: Mood[] }>('/api/admin/music', { lazy: true })
watch(error, (value) => {
  if (value) showError(t('admin.music.loadError'))
}, { immediate: true })

// Moods are listed by their name in the language the admin reads.
const moods = computed(() => [...(data.value?.moods ?? [])]
  .sort((a, b) => musicMoodName(a, language.value).localeCompare(musicMoodName(b, language.value))))
const moodName = (slug: string) => musicMoodName(moods.value.find((mood) => mood.slug === slug), language.value) || slug
const moodItems = computed(() => moods.value.map((mood) => ({ value: mood.slug, label: musicMoodName(mood, language.value) })))

const show = ref<'active' | 'removed'>('active')
const search = ref('')
const showItems = computed(() => [
  { value: 'active', label: t('admin.music.inLibrary') },
  { value: 'removed', label: t('admin.music.removed') },
])
const rows = computed(() => {
  const text = search.value.trim().toLowerCase()
  return (data.value?.tracks ?? []).filter((track) =>
    track.active === (show.value === 'active')
    && (!text || [track.title, track.artist ?? '', moodName(track.mood)].some((field) => field.toLowerCase().includes(text))),
  )
})

// The whole library loads at once, so it is paged here.
const page = ref(1)
const pageSize = ref(20)
const pagedRows = computed(() => rows.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
watch([search, show, pageSize], () => { page.value = 1 })
// Removing the last track on a page leaves the page empty; step back.
watch(rows, (list) => {
  page.value = Math.min(page.value, Math.max(1, Math.ceil(list.length / pageSize.value)))
})

function formatDuration(seconds: number) {
  const whole = Math.round(Number(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

function errorMessage(failure: unknown, fallback: string) {
  const code = (failure as { data?: { data?: { code?: string } } }).data?.data?.code
  return code ? t(`admin.music.error.${code}`) : fallback
}

// Only one track plays at a time; opening another stops the first.
const playing = ref<string | null>(null)
const busy = ref(false)

const adding = ref(false)
const file = ref<File | null>(null)
const emptyForm = () => ({ title: '', artist: '', mood: moods.value[0]?.slug ?? '' })
const form = reactive(emptyForm())
function openAdd() {
  Object.assign(form, emptyForm())
  file.value = null
  adding.value = true
}
// The file name is a good first guess at the title.
watch(file, (picked) => {
  if (picked && !form.title) form.title = picked.name.replace(/\.mp3$/i, '')
})
const canSave = computed(() => !!file.value && !!form.title.trim() && !!form.mood)

async function save() {
  if (!canSave.value || busy.value) return
  busy.value = true
  try {
    const body = new FormData()
    body.append('file', file.value!)
    for (const [key, value] of Object.entries(form)) body.append(key, value)
    await $fetch('/api/admin/music', { method: 'POST', body })
    showSuccess(t('admin.music.added'))
    adding.value = false
    await refresh()
  } catch (failure) {
    showError(errorMessage(failure, t('admin.music.addError')))
  } finally {
    busy.value = false
  }
}

const removing = ref<Track | null>(null)
async function setActive(track: Track, active: boolean) {
  if (busy.value) return
  busy.value = true
  try {
    await $fetch(`/api/admin/music/${track.id}`, { method: 'PATCH', body: { active } })
    showSuccess(t(active ? 'admin.music.restored' : 'admin.music.removedNotice'))
    removing.value = null
    if (playing.value === track.id) playing.value = null
    await refresh()
  } catch (failure) {
    showError(errorMessage(failure, t('admin.music.changeError')))
  } finally {
    busy.value = false
  }
}

// A mood has a name in every app language; English is required and stands in
// for the others left empty.
const languages = APP_LOCALES.map((locale) => locale.slice(0, 2))
const moodsOpen = ref(false)
const editingMood = ref<Mood | null>(null)
const moodOpen = ref(false)
const moodForm = reactive({ names: {} as Record<string, string> })
function openMood(mood: Mood | null) {
  editingMood.value = mood
  moodForm.names = Object.fromEntries(languages.map((code) => [code, mood?.names[code] ?? '']))
  moodOpen.value = true
}
async function saveMood() {
  if (!moodForm.names.en?.trim() || busy.value) return
  busy.value = true
  try {
    const body = { names: moodForm.names }
    await (editingMood.value
      ? $fetch(`/api/admin/music/moods/${editingMood.value.slug}`, { method: 'PUT', body })
      : $fetch('/api/admin/music/moods', { method: 'POST', body }))
    showSuccess(t('admin.music.moodSaved'))
    moodOpen.value = false
    await refresh()
  } catch (failure) {
    showError(errorMessage(failure, t('admin.music.moodSaveError')))
  } finally {
    busy.value = false
  }
}
const deletingMood = ref<Mood | null>(null)
async function deleteMood() {
  if (!deletingMood.value || busy.value) return
  busy.value = true
  try {
    await $fetch(`/api/admin/music/moods/${deletingMood.value.slug}`, { method: 'DELETE', body: {} })
    showSuccess(t('admin.music.moodDeleted'))
    deletingMood.value = null
    await refresh()
  } catch (failure) {
    showError(errorMessage(failure, t('admin.music.moodDeleteError')))
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <AdminPage :title="t('admin.music.title')">
    <UCard class="shrink-0" :ui="{ header: 'px-3 py-3 sm:px-4' }">
      <template #header>
        <p class="mb-3 text-sm text-muted">{{ t('admin.music.description') }}</p>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_14rem_auto_auto]">
          <UInput
            v-model="search"
            icon="i-lucide-search"
            type="search"
            :placeholder="t('admin.music.search')"
            :aria-label="t('admin.music.search')"
          />
          <USelect v-model="show" :items="showItems" class="w-full" />
          <UButton
            icon="i-lucide-tags"
            color="neutral"
            variant="outline"
            class="justify-center"
            :label="t('admin.music.moods')"
            @click="moodsOpen = true"
          />
          <UButton icon="i-lucide-plus" class="justify-center" :label="t('admin.music.add')" :disabled="!moods.length" @click="openAdd" />
        </div>
      </template>
      <UProgress v-if="status === 'pending' && !data" />
      <p v-else-if="!rows.length" class="py-8 text-center text-sm text-muted">
        {{ show === 'active' ? t('admin.music.empty') : t('admin.music.emptyRemoved') }}
      </p>
      <ul v-else class="-mx-2 divide-y divide-default">
        <li v-for="track in pagedRows" :key="track.id" class="flex flex-wrap items-center gap-x-3 gap-y-2 px-2 py-2.5">
          <UButton
            :icon="playing === track.id ? 'i-lucide-pause' : 'i-lucide-play'"
            color="neutral"
            variant="soft"
            size="sm"
            class="shrink-0"
            :aria-label="t(playing === track.id ? 'admin.music.pause' : 'admin.music.play', { title: track.title })"
            @click="playing = playing === track.id ? null : track.id"
          />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-highlighted">{{ track.title }}</p>
            <p v-if="track.artist" class="truncate text-xs text-muted">{{ track.artist }}</p>
          </div>
          <UBadge variant="subtle" color="neutral" class="shrink-0" :label="moodName(track.mood)" />
          <span class="w-12 shrink-0 text-right text-xs tabular-nums text-dimmed">{{ formatDuration(track.duration_seconds) }}</span>
          <UButton
            v-if="track.active"
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            size="sm"
            class="shrink-0"
            :aria-label="t('admin.music.remove')"
            @click="removing = track"
          />
          <UButton
            v-else
            icon="i-lucide-rotate-ccw"
            color="neutral"
            variant="ghost"
            size="sm"
            class="shrink-0"
            :loading="busy"
            :label="t('admin.music.restore')"
            @click="setActive(track, true)"
          />
          <audio
            v-if="playing === track.id"
            :src="`/api/admin/music/${track.id}/file`"
            autoplay
            controls
            class="w-full"
            @ended="playing = null"
          />
        </li>
      </ul>
    </UCard>

    <UModal
      v-model:open="moodsOpen"
      :title="t('admin.music.moods')"
      :description="t('admin.music.moodsDescription')"
    >
      <template #body>
        <p v-if="!moods.length" class="py-6 text-center text-sm text-muted">{{ t('admin.music.noMoods') }}</p>
        <ul v-else class="-mx-2 divide-y divide-default">
          <li v-for="mood in moods" :key="mood.slug" class="flex items-center gap-3 px-2 py-2">
            <span class="min-w-0 flex-1 truncate text-sm font-medium text-highlighted">{{ musicMoodName(mood, language) }}</span>
            <span class="shrink-0 text-xs text-muted">{{ t('admin.music.trackCount', { count: mood.track_count }) }}</span>
            <UButton
              icon="i-lucide-pencil"
              color="neutral"
              variant="ghost"
              size="sm"
              :aria-label="t('admin.music.editMood')"
              @click="openMood(mood)"
            />
            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              size="sm"
              :disabled="mood.track_count > 0"
              :title="mood.track_count > 0 ? t('admin.music.error.MUSIC_MOOD_IN_USE') : undefined"
              :aria-label="t('admin.music.deleteMood')"
              @click="deletingMood = mood"
            />
          </li>
        </ul>
      </template>
      <template #footer>
        <div class="flex w-full justify-end">
          <UButton icon="i-lucide-plus" :label="t('admin.music.addMood')" @click="openMood(null)" />
        </div>
      </template>
    </UModal>

    <UModal v-model:open="adding" :dismissible="!busy" :title="t('admin.music.add')">
      <template #body>
        <UForm :state="form" class="space-y-4" @submit="save">
          <UFormField :label="t('admin.music.file')" :hint="t('admin.music.fileHint')" required>
            <UFileUpload
              v-model="file"
              accept="audio/mpeg,.mp3"
              icon="i-lucide-music"
              :label="t('admin.music.file')"
              :disabled="busy"
              layout="list"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="t('admin.music.trackTitle')" required>
            <UInput v-model="form.title" class="w-full" maxlength="120" />
          </UFormField>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <UFormField :label="t('admin.music.artist')">
              <UInput v-model="form.artist" class="w-full" maxlength="120" />
            </UFormField>
            <UFormField :label="t('admin.music.moodLabel')" required>
              <USelect v-model="form.mood" :items="moodItems" class="w-full" />
            </UFormField>
          </div>
        </UForm>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="busy" @click="adding = false">
            {{ t('admin.requests.cancel') }}
          </UButton>
          <UButton icon="i-lucide-upload" :loading="busy" :disabled="!canSave" @click="save">
            {{ t('admin.music.save') }}
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="moodOpen"
      :dismissible="!busy"
      :title="editingMood ? t('admin.music.editMood') : t('admin.music.addMood')"
      :description="t('admin.music.moodNamesHint')"
    >
      <template #body>
        <UForm :state="moodForm" class="space-y-3" @submit="saveMood">
          <UFormField
            v-for="code in languages"
            :key="code"
            :label="code.toUpperCase()"
            :required="code === 'en'"
          >
            <UInput v-model="moodForm.names[code]" class="w-full" maxlength="60" />
          </UFormField>
        </UForm>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="busy" @click="moodOpen = false">
            {{ t('admin.requests.cancel') }}
          </UButton>
          <UButton icon="i-lucide-check" :loading="busy" :disabled="!moodForm.names.en?.trim()" @click="saveMood">
            {{ t('admin.music.saveMood') }}
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      :open="!!removing"
      :dismissible="!busy"
      :title="t('admin.music.remove')"
      :description="t('admin.music.removeConfirm', { title: removing?.title ?? '' })"
      @update:open="(value) => { if (!value) removing = null }"
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="busy" @click="removing = null">
            {{ t('admin.requests.cancel') }}
          </UButton>
          <UButton color="error" icon="i-lucide-trash-2" :loading="busy" @click="removing && setActive(removing, false)">
            {{ t('admin.music.remove') }}
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      :open="!!deletingMood"
      :dismissible="!busy"
      :title="t('admin.music.deleteMood')"
      :description="t('admin.music.deleteMoodConfirm', { name: deletingMood ? musicMoodName(deletingMood, language) : '' })"
      @update:open="(value) => { if (!value) deletingMood = null }"
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="busy" @click="deletingMood = null">
            {{ t('admin.requests.cancel') }}
          </UButton>
          <UButton color="error" icon="i-lucide-trash-2" :loading="busy" @click="deleteMood">
            {{ t('admin.music.deleteMood') }}
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Pinned to the bottom of the panel so page numbers are always visible. -->
    <template #footer>
      <ListPagination
        v-model:page="page"
        v-model:page-size="pageSize"
        :total="rows.length"
        :sibling-count="1"
        show-edges
      />
    </template>
  </AdminPage>
</template>
