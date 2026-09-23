<script setup lang="ts">
const { data, base, context, applyBusiness, commit, syncing } = useWorkspace()
const { setLocale, t } = useI18n()
const step = ref(context.value ? Math.min(data.value.onboarding, 2) : 0)
const busy = ref(false)
const error = ref('')
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
  facebookUrl: data.value.brand.facebookUrl,
  instagramUrl: data.value.brand.instagramUrl,
  timezone: data.value.preferences.timezone,
  locale: data.value.preferences.locale,
})
watch(
  () => form.locale,
  (value) => {
    if (value) setLocale(value)
  },
)
const steps = [t('onboarding.business'), t('onboarding.networks'), t('onboarding.firstStep')]
const goalOptions = [
  'Rrit njohjen e biznesit',
  'Gjej kliente te rinj',
  'Promovo produkte ose sherbime',
  'Nderto marredhenie me komunitetin',
]
const goalLabelKeys: Record<string, string> = {
  'Rrit njohjen e biznesit': 'onboarding.goalAwareness',
  'Gjej kliente te rinj': 'onboarding.goalNewCustomers',
  'Promovo produkte ose sherbime': 'onboarding.goalPromote',
  'Nderto marredhenie me komunitetin': 'onboarding.goalCommunity',
}
function goalLabel(goal: string) { return t(goalLabelKeys[goal] || goal) }
const timezoneOptions = [
  { label: t('onboarding.timezoneKosovo'), value: 'Europe/Belgrade' },
  { label: t('onboarding.timezoneAlbania'), value: 'Europe/Tirane' },
  { label: t('onboarding.timezoneNorthMacedonia'), value: 'Europe/Skopje' },
  { label: t('onboarding.timezoneUnitedKingdom'), value: 'Europe/London' },
]
const localeOptions = [
  { label: t('settings.albanianKosovo'), value: 'sq-XK' },
  { label: t('settings.englishUnitedStates'), value: 'en-US' },
]
function toggleGoal(goal: string, checked: boolean) {
  if (checked && !form.goals.includes(goal)) form.goals.push(goal)
  if (!checked) form.goals = form.goals.filter((item) => item !== goal)
}
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
      if (
        form.name.trim().length < 2 ||
        form.city.trim().length < 2 ||
        form.description.trim().length < 10
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
      for (const [value, domain] of [
        [form.instagramUrl, 'instagram.com'],
        [form.facebookUrl, 'facebook.com'],
      ]) {
        if (!value?.trim()) continue
        try {
          const url = new URL(value)
          if (
            url.protocol !== 'https:' ||
            !(url.hostname === domain || url.hostname.endsWith(`.${domain}`))
          )
            throw new Error()
        } catch {
          error.value = t('onboarding.invalidProfileUrl')
          return
        }
      }
      if (
        await commit((d) => {
          d.brand.facebookUrl = form.facebookUrl
          d.brand.instagramUrl = form.instagramUrl
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
        await navigateTo(`${base.value}/content/new`)
      }
    }
  } catch (problem) {
    error.value =
      (problem as { data?: { message?: string } }).data?.message ||
      t('onboarding.saveError')
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <div class="space-y-6">
    <div>
      <UBadge color="neutral" variant="outline">{{ t('onboarding.welcome') }}</UBadge>
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
    <UAlert v-if="localError" color="warning" variant="outline" :title="localError" />
    <UAlert v-if="error" color="error" variant="outline" :title="error" />
    <UForm :state="form" class="space-y-5" @submit="next">
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
          ><UFormField :label="t('onboarding.industry')" name="industry"
            ><UInput
              v-model="form.industry"
              maxlength="200"
              :placeholder="t('onboarding.industryPlaceholder')"
              class="w-full"
          /></UFormField>
        </div>
        <UFormField
          :label="t('onboarding.offer')"
          name="description"
          :description="t('onboarding.offerDescription')"
          required
          ><UTextarea
            v-model="form.description"
            required
            minlength="10"
            maxlength="2000"
            :rows="4"
            class="w-full"
        /></UFormField>
        <UFormField :label="t('onboarding.voice')" name="voice"
          ><UTextarea
            v-model="form.voice"
            maxlength="1000"
            :rows="2"
            :placeholder="t('onboarding.voicePlaceholder')"
            class="w-full"
        /></UFormField>
        <div class="grid sm:grid-cols-2 gap-4">
          <UFormField :label="t('onboarding.timezone')" name="timezone"
            ><USelect v-model="form.timezone" :items="timezoneOptions" class="w-full" /></UFormField
          ><UFormField :label="t('onboarding.language')" name="locale"
            ><USelect v-model="form.locale" :items="localeOptions" class="w-full"
          /></UFormField>
        </div>
        <UFormField
          :label="t('onboarding.goals')"
          :description="t('onboarding.goalsDescription')"
        >
          <div class="grid sm:grid-cols-2 gap-3">
            <UCheckbox
              v-for="goal in goalOptions"
              :key="goal"
              :model-value="form.goals.includes(goal)"
              :label="goalLabel(goal)"
              @update:model-value="toggleGoal(goal, $event === true)"
            />
          </div>
        </UFormField>
        <UFormField
          :label="t('onboarding.facts')"
          :description="t('onboarding.factsDescription')"
        >
          <div class="space-y-3">
            <UCard
              v-for="(fact, index) in form.facts"
              :key="fact.id"
              variant="outline"
              :ui="{ body: 'p-4 space-y-3' }"
            >
              <UTextarea
                v-model="fact.text"
                :rows="2"
                maxlength="1000"
                class="w-full"
                :placeholder="t('onboarding.factPlaceholder', { index: index + 1 })"
              />
              <UInput
                v-model="fact.source"
                maxlength="500"
                class="w-full"
                :placeholder="t('onboarding.factSource')"
              />
              <div class="flex items-center justify-between gap-3">
                <UCheckbox v-model="fact.verified" :label="t('onboarding.factChecked')" />
                <UButton
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-trash-2"
                  :aria-label="t('onboarding.removeFact', { index: index + 1 })"
                  @click="form.facts.splice(index, 1)"
                />
              </div>
            </UCard>
            <UButton color="neutral" variant="outline" icon="i-lucide-plus" @click="addFact"
              >{{ t('onboarding.addFact') }}</UButton
            >
          </div>
        </UFormField>
      </template>
      <template v-else-if="step === 1">
        <SocialConnections compact />
        <UFormField :label="t('onboarding.networkProfileInstagram')" name="instagramUrl"
          ><UInput
            v-model="form.instagramUrl"
            type="url"
            class="w-full"
            :placeholder="t('onboarding.instagramPlaceholder')"
            icon="i-lucide-instagram"
        /></UFormField>
        <UFormField :label="t('onboarding.networkPageFacebook')" name="facebookUrl"
          ><UInput
            v-model="form.facebookUrl"
            type="url"
            class="w-full"
            :placeholder="t('onboarding.facebookPlaceholder')"
            icon="i-lucide-facebook"
        /></UFormField>
        <p class="text-xs text-muted leading-relaxed">
          {{ t('onboarding.networksNote') }}
        </p>
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
          :disabled="busy"
          color="neutral"
          variant="outline"
          icon="i-lucide-arrow-left"
          @click="step--"
          >{{ t('onboarding.back') }}</UButton
        ><UButton
          :loading="busy"
          type="submit"
          variant="outline"
          trailing-icon="i-lucide-arrow-right"
          class="flex-1 justify-center"
          >{{
            step === 2 ? t('onboarding.createFirstPost') : step === 1 ? t('onboarding.saveContinue') : t('onboarding.continue')
          }}</UButton
        >
      </div>
      <UButton v-if="context" :to="`${base}/overview`" variant="link" color="neutral" block
        >{{ t('onboarding.finishLater') }}</UButton
      >
    </UForm>
  </div>
</template>
