<script setup lang="ts">
import { TIMEZONE_OPTIONS } from '~~/shared/schemas/workspace'
import { monthlyPlannerPath } from '~/utils/creation-route'
import { authClient } from '~/utils/auth-client'
import { emptyWorkspace } from '~~/shared/utils/empty-workspace'

const { data, base, context, ready, applyBusiness, commit, syncing } = useWorkspace()
const { setLocale, t, locale: activeLocale } = useI18n()
// Three steps: the business, what it sells, then its photos and networks.
// What AI needs to make a good first post is asked for here, not left for
// later: a product to show and a photograph to build on.
const step = ref(context.value ? Math.min(data.value.onboarding, 2) : 0)

// Onboarding is the one signed-in screen with no way out. Somebody who opened
// the wrong account, or whose workspace is gone, would otherwise be stuck here
// through every reload.
const leaving = ref(false)
async function signOut() {
  if (leaving.value) return
  leaving.value = true
  const result = await authClient.signOut()
  if (result.error) {
    error.value = t('onboarding.signOutFailed')
    leaving.value = false
    return
  }
  ready.value = false
  context.value = null
  clearNuxtData()
  data.value = emptyWorkspace()
  await navigateTo('/login')
}
const busy = ref(false)
const error = ref('')
// The first screen asks only what AI planning needs; the rest (voice, goals,
// more facts) is filled in later under My business. Language and time zone
// are taken from what the person is already using.
function browserTimezone() {
  if (!import.meta.client) return ''
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return TIMEZONE_OPTIONS.some((option) => option.value === zone) ? zone : ''
}
const { onFormError, watchError } = useFormFeedback()
watchError(error)
const {
  form,
  localError,
  clear: clearRecovery,
} = useDraft(`onboarding:${context.value?.id || data.value.preferences.email}`, {
  name: data.value.brand.name,
  city: data.value.brand.city,
  industry: data.value.brand.industry,
  description: data.value.brand.description,
  voice: data.value.brand.voice,
  audience: data.value.brand.audience,
  goals: [...data.value.brand.goals],
  timezone: browserTimezone() || data.value.preferences.timezone,
  // The language the person is already reading is the one they chose; a new
  // workspace's stored default must not contradict the screen.
  locale: activeLocale.value,
})
watchError(localError, 'warning')
// The tone of the posts, chosen with a tap. What is stored is a short
// description in the person's language, since that is what AI reads.
const voiceOptions = ['friendly', 'professional', 'playful'] as const
const voiceIcons = {
  friendly: 'i-lucide-smile',
  professional: 'i-lucide-briefcase',
  playful: 'i-lucide-party-popper',
} as const
const chosenVoice = computed(() =>
  voiceOptions.find((option) => form.voice === t(`onboarding.voiceValue.${option}`)),
)
// Up to three products; the first is required. Each is stored as a confirmed
// product fact, the kind the planner shows in pictures and cites in posts.
const maxProducts = 3
const products = reactive(
  (() => {
    const existing = data.value.brand.facts
      .filter((fact) => fact.kind === 'product')
      .map((fact) => ({
        id: fact.id,
        text: fact.text,
        price: fact.amountCents == null ? '' : String(fact.amountCents / 100),
      }))
    return existing.length ? existing : [{ id: crypto.randomUUID(), text: '', price: '' }]
  })(),
)
const productsChecked = ref(
  data.value.brand.facts.some((fact) => fact.kind === 'product' && fact.verified),
)
function addProduct() {
  if (products.length < maxProducts) products.push({ id: crypto.randomUUID(), text: '', price: '' })
}
// Photographs the business owns and may use; at least one is needed to plan.
const ownedPhotos = computed(() =>
  data.value.assets.filter((asset) => asset.kind === 'photo' && asset.rights && !asset.generated),
)
watch(
  () => form.locale,
  (value) => {
    if (value) setLocale(value)
  },
)
const steps = computed(() => [
  t('onboarding.business'),
  t('onboarding.products'),
  t('onboarding.networks'),
])
// The free "Improve with AI" allowance, shared by every field.
const improvementsLeft = ref<number | null>(null)
onMounted(async () => {
  try {
    improvementsLeft.value = (await $fetch<{ remaining: number }>('/api/onboarding/improve')).remaining
  } catch {
    // The count is only shown; the server still enforces the limit.
  }
})
const briefContext = computed(() => ({
  name: form.name,
  city: form.city,
  industry: form.industry,
  description: form.description,
  audience: form.audience,
}))
async function next() {
  if (busy.value || syncing.value) return
  error.value = ''
  busy.value = true
  try {
    if (step.value === 0) {
      if (
        form.name.trim().length < 2 ||
        form.city.trim().length < 2 ||
        !form.industry.trim() ||
        form.description.trim().length < 10 ||
        !form.audience.trim() ||
        !form.voice.trim()
      ) {
        error.value = t('onboarding.requiredBusinessFields')
        return
      }
      if (!context.value)
        applyBusiness(
          await $fetch('/api/business', {
            method: 'POST',
            body: {
              name: form.name,
              city: form.city,
              industry: form.industry,
              description: form.description,
              voice: form.voice,
              audience: form.audience,
              goals: form.goals,
              timezone: form.timezone,
              locale: form.locale,
            },
            retry: 0,
          }),
        )
      else if (
        !(await commit((d) => {
          Object.assign(d.brand, {
            name: form.name,
            city: form.city,
            industry: form.industry,
            description: form.description,
            voice: form.voice,
            audience: form.audience,
            goals: form.goals,
          })
          Object.assign(d.preferences, {
            timezone: form.timezone,
            locale: form.locale,
          })
          d.onboarding = 1
        }))
      )
        return
      step.value = 1
    } else if (step.value === 1) {
      const listed = products.filter((product) => product.text.trim())
      if (!listed.length || !productsChecked.value) {
        error.value = t('onboarding.requiredProducts')
        return
      }
      const others = data.value.brand.facts.filter((fact) => fact.kind !== 'product')
      if (
        !(await commit((d) => {
          d.brand.facts = [
            ...listed.map((product) => {
              const price = Number(String(product.price).replace(',', '.'))
              const priced = String(product.price).trim() !== '' && price > 0
              return {
                id: product.id,
                text: product.text.trim(),
                source: t('brand.defaultSource'),
                verified: true,
                kind: 'product' as const,
                amountCents: priced ? Math.round(price * 100) : null,
                currency: priced ? ('EUR' as const) : null,
              }
            }),
            ...others,
          ]
          d.onboarding = Math.max(d.onboarding, 2)
        }))
      )
        return
      clearRecovery()
      step.value = 2
    } else {
      if (!ownedPhotos.value.length) {
        error.value = t('onboarding.requiredPhoto')
        return
      }
      // The networks are the last step; the planner is where the first post
      // is made, so saving them leads straight there.
      if (
        await commit((d) => {
          d.onboarding = 3
        })
      ) {
        clearRecovery()
        await navigateTo(monthlyPlannerPath(base.value))
      }
    }
  } catch (problem) {
    error.value = t(
      (problem as { data?: { message?: string } }).data?.message || 'onboarding.saveError')
  } finally {
    busy.value = false
  }
}
async function finishLater() {
  if (busy.value || syncing.value || !context.value) return
  error.value = ''
  busy.value = true
  try {
    if (await commit((draft) => { draft.onboardingSkipped = true }))
      await navigateTo(`${base.value}/overview`)
  } catch (problem) {
    error.value = t(
      (problem as { data?: { message?: string } }).data?.message || 'onboarding.saveError')
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <div class="space-y-6">
    <div>
      <h1>
        {{
          [
            t('onboarding.businessIntro'), t('onboarding.productsIntro'), t('onboarding.networksIntro'),
          ][step]
        }}
      </h1>
      <p class="text-sm text-muted leading-relaxed mt-3">
        {{
          [
            t('onboarding.businessDescription'), t('onboarding.productsDescription'), t('onboarding.photosDescription'),
          ][step]
        }}
      </p>
    </div>
    <UStepper
      :model-value="step"
      :items="steps.map((title, value) => ({ title, value }))"
      disabled
      size="sm"
      :aria-label="t('onboarding.businessSetup')"
    />
    <span role="status" class="sr-only">{{ t('onboarding.stepStatus', { step: step + 1 }) }}: {{ steps[step] }}</span>
    <UForm :state="form" class="space-y-5" @submit="next" @error="onFormError">
      <template v-if="step === 0">
        <UFormField :label="t('onboarding.businessName')" name="name" required
          ><UInput
            v-model="form.name"
            required
            minlength="2"
            maxlength="120"
            class="w-full"
            :placeholder="t('onboarding.businessNamePlaceholder')"
        /></UFormField>
        <div class="grid sm:grid-cols-2 gap-4">
          <UFormField :label="t('onboarding.city')" name="city" required
            ><UInput
              v-model="form.city"
              required
              minlength="2"
              maxlength="120"
              :placeholder="t('onboarding.cityPlaceholder')"
              class="w-full" /></UFormField
          ><UFormField :label="t('onboarding.industry')" name="industry" required
            ><UInput
              v-model="form.industry"
              required
              maxlength="200"
              :placeholder="t('onboarding.industryPlaceholder')"
              class="w-full"
          /></UFormField>
        </div>
        <UFormField :label="t('onboarding.offer')" name="description" required
          ><UTextarea
            v-model="form.description"
            required
            minlength="10"
            maxlength="2000"
            :rows="3"
            :placeholder="t('onboarding.offerDescription')"
            class="w-full"
          /><BriefImprove
            v-model:remaining="improvementsLeft"
            class="mt-2"
            field="description"
            :text="form.description"
            :business="briefContext"
            @apply="form.description = $event"
        /></UFormField>
        <UFormField :label="t('brand.audience')" name="audience" required
          ><UTextarea
            v-model="form.audience"
            required
            maxlength="1000"
            :rows="2"
            :placeholder="t('brand.audiencePlaceholder')"
            class="w-full"
          /><BriefImprove
            v-model:remaining="improvementsLeft"
            class="mt-2"
            field="audience"
            :text="form.audience"
            :business="briefContext"
            @apply="form.audience = $event"
        /></UFormField>
        <UFormField :label="t('onboarding.voice')" :description="t('onboarding.voiceHint')" required>
          <div class="grid gap-3 sm:grid-cols-3" role="radiogroup" :aria-label="t('onboarding.voice')">
            <UButton
              v-for="option in voiceOptions"
              :key="option"
              type="button"
              role="radio"
              :aria-checked="chosenVoice === option"
              color="neutral"
              variant="outline"
              class="relative h-full flex-col items-start gap-2 rounded-xl p-4 text-left font-normal transition"
              :class="
                chosenVoice === option
                  ? 'ring-2 ring-primary bg-primary/5 hover:bg-primary/10'
                  : 'hover:ring-1 hover:ring-primary/40'
              "
              @click="form.voice = t(`onboarding.voiceValue.${option}`)"
            >
              <span
                class="flex size-9 items-center justify-center rounded-full"
                :class="chosenVoice === option ? 'bg-primary text-inverted' : 'bg-elevated text-primary'"
              >
                <UIcon :name="voiceIcons[option]" class="size-5" />
              </span>
              <span class="text-sm font-semibold text-highlighted">{{ t(`onboarding.voiceOption.${option}`) }}</span>
              <span class="text-xs leading-5 text-muted">{{ t(`onboarding.voiceExample.${option}`) }}</span>
              <UIcon
                v-if="chosenVoice === option"
                name="i-lucide-circle-check"
                class="absolute right-3 top-3 size-5 text-primary"
              />
            </UButton>
          </div>
        </UFormField>
      </template>
      <template v-else-if="step === 1">
        <div
          v-for="(product, i) in products"
          :key="product.id"
          class="grid gap-3 sm:grid-cols-[1fr_8rem]"
        >
          <UFormField :label="t('onboarding.productLabel', { index: i + 1 })" :required="i === 0">
            <UInput
              v-model="product.text"
              maxlength="1000"
              class="w-full"
              :placeholder="t('brand.kindPlaceholder.product')"
            />
            <BriefImprove
              v-model:remaining="improvementsLeft"
              class="mt-2"
              field="fact"
              :text="product.text"
              :business="briefContext"
              @apply="product.text = $event"
            />
          </UFormField>
          <UFormField :label="t('brand.price')">
            <UInput v-model="product.price" type="number" min="0.01" step="0.01" class="w-full" />
          </UFormField>
        </div>
        <UButton
          v-if="products.length < maxProducts"
          type="button"
          variant="outline"
          icon="i-lucide-plus"
          @click="addProduct"
          >{{ t('brand.add.product') }}</UButton
        >
        <UCheckbox v-model="productsChecked" :label="t('onboarding.productsChecked')" />
      </template>
      <template v-else>
        <UFormField :label="t('onboarding.photos')" :description="t('onboarding.photosHint')" required>
          <div class="flex flex-wrap items-center gap-3">
            <PhotoUpload />
            <UBadge :color="ownedPhotos.length ? 'success' : 'warning'" variant="subtle">{{
              t('onboarding.photosCount', { count: ownedPhotos.length })
            }}</UBadge>
          </div>
        </UFormField>
        <LogoUpload />
        <div class="grid gap-3 sm:grid-cols-2">
          <SocialConnections compact />
          <InstagramConnection />
          <TikTokConnection />
        </div>
      </template>
      <div class="flex gap-3">
        <UButton
          v-if="step > 0"
          type="button"
          :disabled="busy"
          color="neutral"
          variant="outline"
          icon="i-lucide-arrow-left"
          @click="step--"
          >{{ t('onboarding.back') }}</UButton
        ><UButton
          :loading="busy"
          type="submit"
          trailing-icon="i-lucide-arrow-right"
          class="flex-1 justify-center"
          >{{
            step === 2 ? t('onboarding.saveContinue') : t('onboarding.continue')
          }}</UButton
        >
      </div>
      <UButton v-if="context" type="button" variant="ghost" color="neutral" block @click="finishLater"
        >{{ t('onboarding.finishLater') }}</UButton
      >
      <!-- The one way out of onboarding, for someone signed in to the wrong
           account; kept small, since it is rarely what anyone came for. -->
      <div class="flex justify-center">
        <UButton
          type="button"
          size="xs"
          color="neutral"
          variant="link"
          icon="i-lucide-log-out"
          :loading="leaving"
          @click="signOut"
          >{{ t('onboarding.signOut') }}</UButton
        >
      </div>
    </UForm>
  </div>
</template>
