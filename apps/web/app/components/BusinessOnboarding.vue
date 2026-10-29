<script setup lang="ts">
import { TIMEZONE_OPTIONS } from '~~/shared/schemas/workspace'
import { monthlyPlannerPath } from '~/utils/creation-route'
import { authClient } from '~/utils/auth-client'
import { emptyWorkspace } from '~~/shared/utils/empty-workspace'

const { data, base, context, ready, applyBusiness, commit, syncing } = useWorkspace()
const { setLocale, t, locale: activeLocale } = useI18n()
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
  facts: data.value.brand.facts.map((fact) => ({ ...fact })),
  timezone: browserTimezone() || data.value.preferences.timezone,
  // The language the person is already reading is the one they chose; a new
  // workspace's stored default must not contradict the screen.
  locale: activeLocale.value,
})
watchError(localError, 'warning')
// One fact is needed before AI planning can start, so the first screen has one.
if (!form.facts.length) addFact()
watch(
  () => form.locale,
  (value) => {
    if (value) setLocale(value)
  },
)
const steps = computed(() => [t('onboarding.business'), t('onboarding.networks'), t('onboarding.firstStep')])
function addFact() {
  form.facts.push({
    id: crypto.randomUUID(),
    text: '',
    source: t('brand.defaultSource'),
    verified: false,
  })
}
async function next() {
  if (busy.value || syncing.value) return
  error.value = ''
  busy.value = true
  try {
    if (step.value === 0) {
      const fact = form.facts[0]
      if (
        form.name.trim().length < 2 ||
        form.city.trim().length < 2 ||
        !form.industry.trim() ||
        form.description.trim().length < 10 ||
        !form.audience.trim() ||
        !fact?.text.trim() ||
        !fact.verified
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
              facts: form.facts,
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
            facts: form.facts,
          })
          Object.assign(d.preferences, {
            timezone: form.timezone,
            locale: form.locale,
          })
          d.onboarding = 1
        }))
      )
        return
      clearRecovery()
      step.value = 1
    } else if (step.value === 1) {
      if (
        await commit((d) => {
          d.onboarding = 2
        })
      ) {
        clearRecovery()
        step.value = 2
      }
    } else {
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
      <div class="flex items-start justify-between gap-3">
        <UBadge color="neutral" variant="outline">{{ t('onboarding.welcome') }}</UBadge>
        <UButton
          type="button"
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-log-out"
          :loading="leaving"
          @click="signOut"
          >{{ t('onboarding.signOut') }}</UButton
        >
      </div>
      <h1 class="mt-4">
        {{
          [
            t('onboarding.businessIntro'), t('onboarding.networksIntro'), t('onboarding.firstPostIntro'),
          ][step]
        }}
      </h1>
      <p class="text-sm text-muted leading-relaxed mt-3">
        {{
          [
            t('onboarding.businessDescription'), t('onboarding.networksDescription'), t('onboarding.firstPostDescription'),
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
        /></UFormField>
        <UFormField :label="t('brand.audience')" name="audience" required
          ><UTextarea
            v-model="form.audience"
            required
            maxlength="1000"
            :rows="2"
            :placeholder="t('brand.audiencePlaceholder')"
            class="w-full"
        /></UFormField>
        <UFormField v-if="form.facts[0]" :label="t('onboarding.firstFact')" required>
          <div class="space-y-2">
            <UInput
              v-model="form.facts[0].text"
              required
              maxlength="1000"
              class="w-full"
              :placeholder="t('onboarding.firstFactPlaceholder')"
            />
            <UCheckbox v-model="form.facts[0].verified" :label="t('onboarding.factChecked')" />
          </div>
        </UFormField>
      </template>
      <template v-else-if="step === 1">
        <LogoUpload />
        <div class="grid gap-3 sm:grid-cols-2">
          <SocialConnections compact />
          <InstagramConnection />
          <TikTokConnection />
        </div>
      </template>
      <template v-else>
        <UCard :ui="{ body: 'p-5 space-y-4' }"
          ><UUser
            :name="data.brand.name"
            :description="data.brand.city"
            :avatar="{ alt: data.brand.name }"
          /><USeparator />
          <p class="text-sm leading-relaxed">{{ data.brand.description }}</p></UCard
        >
        <ol class="space-y-4">
          <li
            v-for="(item, index) in [
              t('onboarding.firstPostStepOne'), t('onboarding.firstPostStepTwo'), t('onboarding.firstPostStepThree'),
            ]"
            :key="item"
            class="flex gap-3 items-start text-sm leading-relaxed"
          >
            <UBadge color="neutral" variant="outline" class="shrink-0">{{ index + 1 }}</UBadge
            >{{ item }}
          </li>
        </ol>
        <p class="text-xs text-muted">
          {{ t('onboarding.firstPostNote') }}
        </p>
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
            step === 2 ? t('onboarding.createFirstPost') : step === 1 ? t('onboarding.saveContinue') : t('onboarding.continue')
          }}</UButton
        >
      </div>
      <UButton v-if="context" type="button" variant="ghost" color="neutral" block @click="finishLater"
        >{{ t('onboarding.finishLater') }}</UButton
      >
    </UForm>
  </div>
</template>
