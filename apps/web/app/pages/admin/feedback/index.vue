<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'superadmin' })
const { t, locale } = useI18n()
const { showError, showSuccess } = useFormFeedback()
useSeoMeta({
  title: () => `${t('admin.nav.feedback')} · Framic Admin`,
  robots: 'noindex, nofollow',
})

type Feedback = {
  id: string
  organization_id: string
  organization_name: string | null
  user_email: string | null
  category: 'bug' | 'feature' | 'improvement' | 'other'
  page_url: string
  message: string
  photo_paths: string[]
  created_at: string
}

const { data, status, error, refresh } = await useFetch<{ feedback: Feedback[] }>(
  '/api/admin/feedback',
  // Same key as the admin layout's badge poll, so new feedback shows up here
  // as soon as the badge counts it.
  { lazy: true, key: 'admin-feedback-count' },
)
watch(error, (value) => {
  if (value) showError(t('admin.feedback.loadError'))
}, { immediate: true })

const categories = ['all', 'bug', 'feature', 'improvement', 'other'] as const
const category = ref<(typeof categories)[number]>('all')
const search = ref('')
const categoryItems = computed(() =>
  categories.map((value) => ({
    value,
    label: value === 'all' ? t('admin.feedback.allCategories') : t(`admin.feedback.category.${value}`),
  })),
)
const rows = computed(() => {
  const text = search.value.trim().toLowerCase()
  return (data.value?.feedback ?? []).filter((entry) =>
    (category.value === 'all' || entry.category === category.value)
    && (!text || [entry.message, entry.page_url, entry.organization_name, entry.user_email]
      .some((field) => field?.toLowerCase().includes(text))),
  )
})
const categoryColor = {
  bug: 'error',
  feature: 'info',
  improvement: 'success',
  other: 'neutral',
} as const
const categoryIcon = {
  bug: 'i-lucide-bug',
  feature: 'i-lucide-sparkles',
  improvement: 'i-lucide-trending-up',
  other: 'i-lucide-message-circle',
} as const

function formatDate(value: string) {
  return new Date(value).toLocaleString(locale.value)
}

const viewing = ref<Feedback | null>(null)
// Index of the photo open in the preview; it wraps around at either end.
const previewPhoto = ref<number | null>(null)
const photoCount = computed(() => viewing.value?.photo_paths.length ?? 0)
function stepPhoto(direction: 1 | -1) {
  if (previewPhoto.value === null || !photoCount.value) return
  previewPhoto.value = (previewPhoto.value + direction + photoCount.value) % photoCount.value
}
function onPhotoKey(event: KeyboardEvent) {
  if (event.key === 'ArrowLeft') stepPhoto(-1)
  else if (event.key === 'ArrowRight') stepPhoto(1)
}
onMounted(() => window.addEventListener('keydown', onPhotoKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onPhotoKey))
const deleting = ref<Feedback | null>(null)
const busy = ref(false)
async function confirmDelete() {
  if (!deleting.value || busy.value) return
  busy.value = true
  try {
    await $fetch(`/api/admin/feedback/${deleting.value.id}`, { method: 'DELETE', body: {} })
    showSuccess(t('admin.feedback.deleted'))
    deleting.value = null
    viewing.value = null
    await refresh()
  } catch {
    showError(t('admin.feedback.deleteError'))
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <AdminPage :title="t('admin.feedback.title')">
    <UCard class="shrink-0" :ui="{ header: 'px-3 py-3 sm:px-4' }">
      <template #header>
        <p class="mb-3 text-sm text-muted">{{ t('admin.feedback.description') }}</p>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_14rem]">
          <UInput
            v-model="search"
            icon="i-lucide-search"
            type="search"
            :placeholder="t('admin.feedback.search')"
            :aria-label="t('admin.feedback.search')"
          />
          <USelect v-model="category" :items="categoryItems" class="w-full" />
        </div>
      </template>
      <UProgress v-if="status === 'pending' && !data" />
      <p v-else-if="!rows.length" class="py-8 text-center text-sm text-muted">
        {{ t('admin.feedback.empty') }}
      </p>
      <!-- The list only says what each entry is about; the full message, page
           and photos open in the details modal. -->
      <ul v-else class="-mx-2 divide-y divide-default">
        <li v-for="entry in rows" :key="entry.id" class="flex items-center gap-1">
          <UButton
            color="neutral"
            variant="ghost"
            class="min-w-0 flex-1 justify-start gap-3 rounded-md px-2 py-2.5 text-left font-normal"
            @click="viewing = entry"
          >
            <span class="flex w-40 shrink-0">
              <UBadge
                :color="categoryColor[entry.category]"
                :icon="categoryIcon[entry.category]"
                variant="subtle"
                class="whitespace-nowrap"
                :label="t(`admin.feedback.category.${entry.category}`)"
              />
            </span>
            <span class="w-40 shrink-0 truncate font-medium text-highlighted">{{ entry.organization_name }}</span>
            <span class="min-w-0 flex-1 truncate text-muted">{{ entry.message }}</span>
            <span v-if="entry.photo_paths.length" class="flex shrink-0 items-center gap-1 text-xs text-muted">
              <UIcon name="i-lucide-image" class="size-4" />{{ entry.photo_paths.length }}
            </span>
            <span class="hidden shrink-0 text-xs text-dimmed sm:inline">{{ formatDate(entry.created_at) }}</span>
          </UButton>
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            size="sm"
            class="shrink-0"
            :aria-label="t('admin.feedback.delete')"
            @click="deleting = entry"
          />
        </li>
      </ul>
    </UCard>
    <UModal
      :open="!!viewing"
      :title="t('admin.feedback.details')"
      :ui="{ content: 'sm:max-w-4xl', body: 'p-5 sm:p-8' }"
      @update:open="(value) => { if (!value) viewing = null }"
    >
      <template #header>
        <div v-if="viewing" class="flex min-w-0 flex-1 items-center gap-3">
          <UBadge
            :color="categoryColor[viewing.category]"
            :icon="categoryIcon[viewing.category]"
            variant="subtle"
            size="lg"
            class="whitespace-nowrap"
            :label="t(`admin.feedback.category.${viewing.category}`)"
          />
          <div class="min-w-0">
            <p class="truncate text-lg font-semibold text-highlighted">{{ viewing.organization_name }}</p>
            <p class="text-sm text-muted">{{ formatDate(viewing.created_at) }}</p>
          </div>
        </div>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          :aria-label="t('admin.requests.cancel')"
          @click="viewing = null"
        />
      </template>
      <template #body>
        <div v-if="viewing" class="space-y-6">
          <dl class="rounded-lg border border-default bg-elevated/40 p-4">
            <dt class="text-xs font-medium uppercase tracking-wide text-dimmed">{{ t('admin.feedback.client') }}</dt>
            <dd class="mt-1 break-all text-sm text-highlighted">{{ viewing.user_email }}</dd>
          </dl>
          <section>
            <h3 class="mb-2 text-xs font-medium uppercase tracking-wide text-dimmed">{{ t('admin.feedback.message') }}</h3>
            <p class="whitespace-pre-wrap break-words rounded-lg border border-default p-5 text-base leading-relaxed">{{ viewing.message }}</p>
          </section>
          <section v-if="viewing.photo_paths.length">
            <h3 class="mb-2 text-xs font-medium uppercase tracking-wide text-dimmed">
              {{ t('admin.feedback.photo') }} ({{ viewing.photo_paths.length }})
            </h3>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <UButton
                v-for="(_, index) in viewing.photo_paths"
                :key="index"
                color="neutral"
                variant="link"
                class="group relative overflow-hidden rounded-lg p-0"
                :aria-label="t('admin.feedback.photo')"
                @click="previewPhoto = index"
              >
                <img
                  :src="`/api/admin/feedback/${viewing.id}/photos/${index}`"
                  alt=""
                  loading="lazy"
                  class="aspect-video w-full rounded-lg object-cover ring-1 ring-default transition group-hover:opacity-80"
                >
                <UIcon
                  name="i-lucide-maximize-2"
                  class="absolute right-3 top-3 size-5 text-white opacity-0 drop-shadow transition group-hover:opacity-100"
                />
              </UButton>
            </div>
          </section>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-between gap-2">
          <UButton color="neutral" variant="ghost" :label="t('admin.requests.cancel')" @click="viewing = null" />
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="soft"
            :label="t('admin.feedback.delete')"
            @click="deleting = viewing"
          />
        </div>
      </template>
    </UModal>
    <UModal
      :open="previewPhoto !== null"
      :title="photoCount > 1 ? `${t('admin.feedback.photo')} ${(previewPhoto ?? 0) + 1} / ${photoCount}` : t('admin.feedback.photo')"
      :ui="{ content: 'sm:max-w-5xl' }"
      @update:open="(value) => { if (!value) previewPhoto = null }"
    >
      <template #body>
        <div v-if="viewing && previewPhoto !== null" class="relative">
          <img
            :src="`/api/admin/feedback/${viewing.id}/photos/${previewPhoto}`"
            alt=""
            class="mx-auto max-h-[80vh] w-auto rounded-md object-contain"
          >
          <template v-if="photoCount > 1">
            <UButton
              icon="i-lucide-chevron-left"
              color="neutral"
              variant="solid"
              size="lg"
              class="absolute left-2 top-1/2 -translate-y-1/2 rounded-full opacity-90"
              :aria-label="t('admin.feedback.previousPhoto')"
              @click="stepPhoto(-1)"
            />
            <UButton
              icon="i-lucide-chevron-right"
              color="neutral"
              variant="solid"
              size="lg"
              class="absolute right-2 top-1/2 -translate-y-1/2 rounded-full opacity-90"
              :aria-label="t('admin.feedback.nextPhoto')"
              @click="stepPhoto(1)"
            />
          </template>
        </div>
      </template>
    </UModal>
    <UModal
      :open="!!deleting"
      :dismissible="!busy"
      :title="t('admin.feedback.delete')"
      :description="t('admin.feedback.deleteConfirm')"
      @update:open="(value) => { if (!value) deleting = null }"
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="busy" @click="deleting = null">
            {{ t('admin.requests.cancel') }}
          </UButton>
          <UButton color="error" icon="i-lucide-trash-2" :loading="busy" @click="confirmDelete">
            {{ t('admin.feedback.delete') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </AdminPage>
</template>
