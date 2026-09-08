<script setup lang="ts">
const { data, base, context, applyBusiness, commit, syncing } = useWorkspace()
const step = ref(context.value ? Math.min(data.value.onboarding, 2) : 0)
const busy = ref(false)
const error = ref('')
const { form, localError } = useDraft(`onboarding:${data.value.preferences.email}`, {
  name: data.value.brand.name,
  city: data.value.brand.city,
  industry: data.value.brand.industry,
  description: data.value.brand.description,
  voice: data.value.brand.voice,
  facebookUrl: data.value.brand.facebookUrl,
  instagramUrl: data.value.brand.instagramUrl,
})
const steps = ['Biznesi', 'Rrjetet', 'Hapi i parë']
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
        error.value = 'Plotëso emrin, qytetin dhe një përshkrim të shkurtër.'
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
            },
            retry: 0,
          }),
        )
      else if (
        !(await commit((d) => {
          Object.assign(d.brand, form)
          d.onboarding = 1
        }))
      )
        return
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
          error.value = 'Përdor një lidhje të plotë të profilit ose lëre bosh për tani.'
          return
        }
      }
      if (
        await commit((d) => {
          d.brand.facebookUrl = form.facebookUrl
          d.brand.instagramUrl = form.instagramUrl
          d.onboarding = 2
        })
      )
        step.value = 2
    } else {
      if (
        await commit((d) => {
          d.onboarding = 3
        })
      )
        await navigateTo(`${base.value}/content/new`)
    }
  } catch (problem) {
    error.value =
      (problem as { data?: { message?: string } }).data?.message ||
      'Konfigurimi nuk u ruajt. Provo sërish.'
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <div class="space-y-6">
    <div>
      <UBadge color="neutral" variant="outline">Mirë se vjen në Rrit</UBadge>
      <h1 class="mt-4">
        {{
          [
            'Na njofto me biznesin tënd.',
            'Profilet që përdor biznesi.',
            'Gati për postimin e parë.',
          ][step]
        }}
      </h1>
      <p class="text-sm text-muted leading-relaxed mt-3">
        {{
          [
            'Të duhen vetëm disa të dhëna. Mund t’i ndryshosh edhe më vonë.',
            'Ruaj lidhjet e profileve. Mund të vazhdosh edhe pa to.',
            'Biznesi yt ka hapësirën e vet. Tani krijojmë një postim, hap pas hapi.',
          ][step]
        }}
      </p>
    </div>
    <UStepper
      :model-value="step"
      :items="steps.map((title, value) => ({ title, value }))"
      disabled
      size="sm"
      aria-label="Konfigurimi i biznesit"
    />
    <span role="status" class="sr-only">Hapi {{ step + 1 }} nga 3: {{ steps[step] }}</span>
    <UAlert v-if="localError" color="warning" variant="outline" :title="localError" />
    <UAlert v-if="error" color="error" variant="outline" :title="error" />
    <UForm :state="form" class="space-y-5" @submit="next">
      <template v-if="step === 0">
        <UFormField label="Emri i biznesit" name="name" required
          ><UInput
            v-model="form.name"
            required
            minlength="2"
            maxlength="120"
            class="w-full"
            placeholder="Si quhet biznesi yt?"
        /></UFormField>
        <div class="grid sm:grid-cols-2 gap-4">
          <UFormField label="Qyteti" name="city" required
            ><UInput
              v-model="form.city"
              required
              minlength="2"
              maxlength="120"
              placeholder="P.sh. Prishtinë"
              class="w-full" /></UFormField
          ><UFormField label="Lloji i biznesit" name="industry"
            ><UInput
              v-model="form.industry"
              maxlength="200"
              placeholder="P.sh. Dyqan lulesh"
              class="w-full"
          /></UFormField>
        </div>
        <UFormField
          label="Çfarë ofron për klientët?"
          name="description"
          description="Produktet, shërbimet dhe çfarë të dallon."
          required
          ><UTextarea
            v-model="form.description"
            required
            minlength="10"
            maxlength="2000"
            :rows="4"
            class="w-full"
        /></UFormField>
        <UFormField label="Si dëshiron të flasësh në postime?" name="voice"
          ><UTextarea
            v-model="form.voice"
            maxlength="1000"
            :rows="2"
            placeholder="P.sh. Thjesht, ngrohtë dhe miqësisht."
            class="w-full"
        /></UFormField>
      </template>
      <template v-else-if="step === 1">
        <SocialConnections compact />
        <UFormField label="Profili në Instagram (opsional)" name="instagramUrl"
          ><UInput
            v-model="form.instagramUrl"
            type="url"
            class="w-full"
            placeholder="https://www.instagram.com/biznesi"
            icon="i-lucide-instagram"
        /></UFormField>
        <UFormField label="Faqja në Facebook (opsionale)" name="facebookUrl"
          ><UInput
            v-model="form.facebookUrl"
            type="url"
            class="w-full"
            placeholder="https://www.facebook.com/biznesi"
            icon="i-lucide-facebook"
        /></UFormField>
        <p class="text-xs text-muted leading-relaxed">
          Adresat më sipër plotësojnë profilin. Qasja te postimet kërkon autorizimin përmes butonit Lidh përmes Meta.
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
              'Zgjidh Facebook ose Instagram dhe shto një fotografi.',
              'Shkruaj mesazhin dhe shiko parapamjen e postimit.',
              'Kontrolloje, miratoje dhe zgjidh ditën në kalendar.',
            ]"
            :key="item"
            class="flex gap-3 items-start text-sm leading-relaxed"
          >
            <UBadge color="neutral" variant="outline" class="shrink-0">{{ index + 1 }}</UBadge
            >{{ item }}
          </li>
        </ol>
        <p class="text-xs text-muted">
          Çdo postim kërkon kontroll dhe miratimin tënd. Asnjë postim nuk publikohet nga ky konfigurim fillestar.
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
          >Pas</UButton
        ><UButton
          :loading="busy"
          type="submit"
          variant="outline"
          trailing-icon="i-lucide-arrow-right"
          class="flex-1 justify-center"
          >{{
            step === 2 ? 'Krijo postimin e parë' : step === 1 ? 'Ruaj dhe vazhdo' : 'Vazhdo'
          }}</UButton
        >
      </div>
      <UButton v-if="context" :to="`${base}/overview`" variant="link" color="neutral" block
        >E plotësoj më vonë</UButton
      >
    </UForm>
  </div>
</template>
