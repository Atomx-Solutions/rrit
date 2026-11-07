<script setup lang="ts">
// How TikTok shows this post. TikTok requires the account holder to choose it
// for every direct post, with no preset privacy, from what the account allows.
const props = defineProps<{ postId: string; video: boolean }>()
const { t } = useI18n()
const creator = ref<{
  nickname: string
  username: string
  privacyLevelOptions: string[]
  commentDisabled: boolean
  duetDisabled: boolean
  stitchDisabled: boolean
} | null>(null)
const loadError = ref('')
const saveError = ref('')
const privacyLevel = ref<string | undefined>()
const allowComment = ref(false)
const allowDuet = ref(false)
const allowStitch = ref(false)
const commercial = ref(false)
const brandOrganic = ref(false)
const brandedContent = ref(false)
const privacyItems = computed(() =>
  (creator.value?.privacyLevelOptions || []).map((value) => ({
    value,
    label: t(`tiktokSettings.privacy.${value}`),
    // TikTok does not allow branded content to be visible only to its creator.
    disabled: value === 'SELF_ONLY' && brandedContent.value,
  })),
)
const complete = computed(
  () => !!creator.value && !!privacyLevel.value && (!commercial.value || brandOrganic.value || brandedContent.value),
)
async function load() {
  loadError.value = ''
  try {
    const [info, stored] = await Promise.all([
      $fetch('/api/tiktok/creator-info'),
      $fetch(`/api/posts/${props.postId}/tiktok-settings`),
    ])
    creator.value = info
    const settings = stored.settings
    if (settings && info.privacyLevelOptions.includes(settings.privacyLevel)) {
      privacyLevel.value = settings.privacyLevel
      allowComment.value = !settings.disableComment && !info.commentDisabled
      allowDuet.value = !settings.disableDuet && !info.duetDisabled
      allowStitch.value = !settings.disableStitch && !info.stitchDisabled
      brandOrganic.value = settings.brandOrganic
      brandedContent.value = settings.brandedContent
      commercial.value = settings.brandOrganic || settings.brandedContent
    }
  } catch (problem) {
    loadError.value = t((problem as { data?: { message?: string } }).data?.message || 'server.TIKTOK_CREATOR_UNAVAILABLE')
  }
}
watch(brandedContent, (branded) => {
  if (branded && privacyLevel.value === 'SELF_ONLY') privacyLevel.value = undefined
})
watch(commercial, (on) => {
  if (!on) {
    brandOrganic.value = false
    brandedContent.value = false
  }
})
/** Stores the choices for this post; false when they are incomplete or refused. */
async function save() {
  saveError.value = ''
  if (!complete.value) {
    saveError.value = t('tiktokSettings.incomplete')
    return false
  }
  try {
    await $fetch(`/api/posts/${props.postId}/tiktok-settings`, {
      method: 'PUT',
      body: {
        privacyLevel: privacyLevel.value,
        disableComment: !allowComment.value,
        disableDuet: !props.video || !allowDuet.value,
        disableStitch: !props.video || !allowStitch.value,
        brandOrganic: brandOrganic.value,
        brandedContent: brandedContent.value,
        consent: true,
      },
      retry: 0,
    })
    return true
  } catch (problem) {
    saveError.value = t((problem as { data?: { message?: string } }).data?.message || 'tiktokSettings.saveFailed')
    return false
  }
}
defineExpose({ save })
onMounted(load)
</script>
<template>
  <div class="space-y-4 rounded-lg border border-default p-4">
    <div>
      <p class="font-semibold text-sm">{{ t('tiktokSettings.title') }}</p>
      <p v-if="creator" class="text-xs text-muted mt-1">
        {{ t('tiktokSettings.account', { nickname: creator.nickname, username: creator.username }) }}
      </p>
    </div>
    <p v-if="loadError" class="text-sm text-error">{{ loadError }}</p>
    <template v-else-if="creator">
      <UFormField :label="t('tiktokSettings.privacyLabel')" required>
        <USelect
          v-model="privacyLevel"
          :items="privacyItems"
          :placeholder="t('tiktokSettings.privacyPlaceholder')"
          class="w-full"
        />
      </UFormField>
      <div class="space-y-2">
        <p class="text-sm font-medium">{{ t('tiktokSettings.interactions') }}</p>
        <UCheckbox v-model="allowComment" :disabled="creator.commentDisabled" :label="t('tiktokSettings.allowComment')" />
        <template v-if="video">
          <UCheckbox v-model="allowDuet" :disabled="creator.duetDisabled" :label="t('tiktokSettings.allowDuet')" />
          <UCheckbox v-model="allowStitch" :disabled="creator.stitchDisabled" :label="t('tiktokSettings.allowStitch')" />
        </template>
      </div>
      <div class="space-y-2">
        <USwitch v-model="commercial" :label="t('tiktokSettings.commercial')" :description="t('tiktokSettings.commercialDescription')" />
        <template v-if="commercial">
          <UCheckbox v-model="brandOrganic" :label="t('tiktokSettings.yourBrand')" :description="t('tiktokSettings.yourBrandDescription')" />
          <UCheckbox v-model="brandedContent" :label="t('tiktokSettings.brandedContent')" :description="t('tiktokSettings.brandedContentDescription')" />
          <p v-if="brandOrganic || brandedContent" class="text-xs text-muted">
            {{ brandedContent ? t('tiktokSettings.labelPaidPartnership') : t('tiktokSettings.labelPromotional') }}
          </p>
        </template>
      </div>
      <p class="text-xs text-muted">
        {{ brandedContent ? t('tiktokSettings.consentBranded') : t('tiktokSettings.consent') }}
      </p>
      <!-- TikTok asks that people know a direct post is processed after it is sent. -->
      <p class="text-xs text-muted">{{ t('tiktokSettings.processingNotice') }}</p>
    </template>
    <p v-else class="text-sm text-muted">{{ t('common.loading') }}</p>
    <p v-if="saveError" class="text-sm text-error">{{ saveError }}</p>
  </div>
</template>
