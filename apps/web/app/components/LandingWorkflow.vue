<script setup lang="ts">
const step = ref('business')
const photo = '/images/table.jpg'
const items = [
  {
    label: 'Biznesi',
    value: 'business',
    icon: 'i-lucide-store',
    title: 'Fillojmë me atë që të bën të veçantë.',
    description:
      'Trego çfarë ofron dhe si flet me klientët. Këto të dhëna mbeten te profili i biznesit tënd.',
    detail: 'HAPI 01 · NJOFTOHU ME SISTEMIN',
  },
  {
    label: 'Postimi',
    value: 'post',
    icon: 'i-lucide-image-plus',
    title: 'Një fotografi. Një mesazh që ka kuptim.',
    description:
      'Bashko fotografinë me tekstin. Lexoje, ndryshoje dhe miratoje kur të jesh i kënaqur.',
    detail: 'HAPI 02 · PËRGATIT DHE MIRATO',
  },
  {
    label: 'Kalendari',
    value: 'calendar',
    icon: 'i-lucide-calendar-days',
    title: 'E di çfarë vjen më pas.',
    description:
      'Vendosi postimet në kalendar dhe ndiq gjendjen e tyre. Lidhjet me rrjetet sociale mund t’i bësh edhe më vonë.',
    detail: 'HAPI 03 · ORGANIZO JAVËN',
  },
]
</script>

<template>
  <UTabs
    v-model="step"
    :items="items"
    class="landing-workflow"
    :ui="{
      list: 'landing-workflow-tabs',
      trigger: 'landing-workflow-trigger',
      indicator: 'rounded-lg',
      content: 'mt-5 focus-visible:outline-offset-4',
    }"
  >
    <template #content="{ item }">
      <UCard class="landing-workflow-card" :ui="{ body: 'p-0 sm:p-0' }">
        <div class="landing-workflow-layout">
          <div class="landing-workflow-copy">
            <span class="landing-kicker">{{ item.detail }}</span>
            <h3>{{ item.title }}</h3>
            <p>{{ item.description }}</p>
            <div class="landing-workflow-progress" aria-hidden="true">
              <span
                v-for="entry in items"
                :key="entry.value"
                :class="{ 'is-active': entry.value === step }"
              />
            </div>
          </div>
          <div class="landing-workflow-visual">
            <div v-if="item.value === 'business'" class="landing-business-example">
              <div class="landing-example-cover">
                <img
                  :src="photo"
                  alt="Filxhanë kafeje për një shembull profili biznesi"
                  width="1000"
                  height="667"
                  loading="lazy"
                />
              </div>
              <div class="landing-example-profile">
                <span class="landing-example-avatar"
                  ><UIcon name="i-lucide-coffee" aria-hidden="true"
                /></span>
                <div><strong>Kafeneja jote</strong><span>Kafe & shoqëri · Prishtinë</span></div>
              </div>
              <dl class="landing-example-facts">
                <div>
                  <dt>Çfarë ofrojmë</dt>
                  <dd>Kafe të mirë dhe një vend për t’u takuar.</dd>
                </div>
                <div>
                  <dt>Si flasim</dt>
                  <dd>Ngrohtë, thjesht dhe me buzëqeshje.</dd>
                </div>
              </dl>
            </div>
            <div v-else-if="item.value === 'post'" class="landing-post-example">
              <div class="landing-example-topline">
                <span>POSTIMI YT</span
                ><UBadge variant="subtle" color="neutral" size="sm">Për miratim</UBadge>
              </div>
              <img
                :src="photo"
                alt="Fotografi kafeje e përzgjedhur për postimin ilustrues"
                width="1000"
                height="667"
                loading="lazy"
              />
              <p>
                Ka gjithmonë kohë për një kafe të mirë. Dhe për njerëzit që ta bëjnë ditën më të
                bukur.
              </p>
              <div class="landing-example-ready">
                <UIcon name="i-lucide-check-check" aria-hidden="true" /> Teksti dhe fotografia, gati
                për kontrollin tënd.
              </div>
            </div>
            <div v-else class="landing-calendar-example">
              <div class="landing-example-topline">
                <span>JAVA JOTE</span><UIcon name="i-lucide-calendar-days" aria-hidden="true" />
              </div>
              <div class="landing-calendar-days" aria-hidden="true">
                <span v-for="(day, index) in ['H', 'M', 'M', 'E', 'P', 'S', 'D']" :key="index">{{
                  day
                }}</span>
              </div>
              <div class="landing-calendar-item">
                <span class="landing-day">HËN</span>
                <div><strong>Kafeja e mëngjesit</strong><span>Fotografia + teksti</span></div>
                <UIcon name="i-lucide-circle-check" aria-label="Miratuar" />
              </div>
              <div class="landing-calendar-item">
                <span class="landing-day">MËR</span>
                <div><strong>Një kënd nga lokali</strong><span>Për miratim</span></div>
                <UIcon name="i-lucide-clock-3" aria-label="Për miratim" />
              </div>
              <div class="landing-calendar-item">
                <span class="landing-day">PRE</span>
                <div><strong>Takimi i fundjavës</strong><span>Draft</span></div>
                <UIcon name="i-lucide-pencil-line" aria-label="Draft" />
              </div>
              <p class="landing-calendar-note">Një javë e organizuar, me hapësirë për ndryshime.</p>
            </div>
            <p class="landing-example-label">Shembull ilustrues i mënyrës së punës</p>
          </div>
        </div>
      </UCard>
    </template>
  </UTabs>
</template>
