<script setup lang="ts">
import type { SlotBrief } from '~~/shared/schemas/monthly-plan'

const props = defineProps<{
  strategy: { objective: string; audience: string; rationale: string; slots: SlotBrief[] }
  assets: Array<{ id: string; name: string; url: string }>
}>()

const intentLabels: Record<string, string> = {
  educate: 'Edukim',
  inspire: 'Frymëzim',
  trust: 'Besim',
  conversation: 'Bisedë',
  product: 'Produkt',
  behind_the_scenes: 'Prapaskena',
  local_relevance: 'Relevancë lokale',
  conversion: 'Konvertim',
}
const goalLabels: Record<string, string> = {
  watch_time: 'Vëmendje',
  saves: 'Ruajtje',
  shares: 'Shpërndarje',
  meaningful_comments: 'Komente me vlerë',
  profile_actions: 'Veprime në profil',
  clicks: 'Klikime',
}
const assetMap = computed(() => new Map(props.assets.map((asset) => [asset.id, asset])))
const channels = computed(() => ({
  Instagram: props.strategy.slots.filter((slot) => slot.channel === 'Instagram').length,
  Facebook: props.strategy.slots.filter((slot) => slot.channel === 'Facebook').length,
}))
const intents = computed(() => new Set(props.strategy.slots.map((slot) => slot.intent)).size)
</script>

<template>
  <div class="space-y-6">
    <section class="overflow-hidden rounded-2xl border border-default bg-default">
      <div class="border-b border-default bg-elevated/40 p-4">
        <div
          class="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-primary"
        >
          <UIcon name="i-lucide-compass" class="size-4" /> Strategjia e muajit
        </div>
        <h3 class="mt-2 max-w-4xl text-lg font-semibold text-highlighted">
          {{ strategy.objective }}
        </h3>
        <p class="mt-3 max-w-4xl text-sm leading-7 text-toned">{{ strategy.rationale }}</p>
      </div>
      <div class="grid gap-px bg-default sm:grid-cols-4">
        <div class="bg-default p-4">
          <span class="text-xs text-muted">Audienca</span>
          <strong class="mt-1 block text-sm text-highlighted">{{ strategy.audience }}</strong>
        </div>
        <div class="bg-default p-4">
          <span class="text-xs text-muted">Instagram</span>
          <strong class="mt-1 block text-lg text-highlighted">{{ channels.Instagram }}</strong>
        </div>
        <div class="bg-default p-4">
          <span class="text-xs text-muted">Facebook</span>
          <strong class="mt-1 block text-lg text-highlighted">{{ channels.Facebook }}</strong>
        </div>
        <div class="bg-default p-4">
          <span class="text-xs text-muted">Intente të ndryshme</span>
          <strong class="mt-1 block text-lg text-highlighted">{{ intents }}</strong>
        </div>
      </div>
    </section>

    <section>
      <div class="flex items-end justify-between gap-3">
        <div>
          <p class="text-xs font-medium uppercase tracking-wide text-muted">Plani editorial</p>
          <h3 class="mt-1 text-lg font-semibold text-highlighted">Çdo postim ka një detyrë</h3>
        </div>
        <UBadge color="neutral" variant="subtle">{{ strategy.slots.length }} postime</UBadge>
      </div>
      <div class="mt-4 grid gap-4 lg:grid-cols-2">
        <article
          v-for="(slot, index) in strategy.slots"
          :key="`${slot.day}-${slot.time}-${slot.channel}`"
          class="rounded-xl border border-default bg-default p-3.5"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-center gap-3">
              <span
                class="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold text-primary"
              >
                {{ index + 1 }}
              </span>
              <div>
                <div class="flex flex-wrap gap-1.5">
                  <UBadge
                    :color="slot.channel === 'Instagram' ? 'primary' : 'info'"
                    variant="subtle"
                  >
                    {{ slot.channel }}
                  </UBadge>
                  <UBadge color="neutral" variant="outline">{{ intentLabels[slot.intent] }}</UBadge>
                </div>
                <h4 class="mt-2 font-semibold text-highlighted">{{ slot.topic }}</h4>
              </div>
            </div>
            <span class="shrink-0 text-xs text-muted">Dita {{ slot.day }} · {{ slot.time }}</span>
          </div>

          <blockquote
            class="mt-4 border-l-2 border-primary/50 pl-3 text-sm font-medium leading-6 text-toned"
          >
            {{ slot.hook }}
          </blockquote>
          <p class="mt-3 text-sm leading-6 text-muted">{{ slot.purpose }}</p>

          <div class="mt-4 grid gap-2 text-xs sm:grid-cols-2">
            <div class="rounded-lg bg-elevated/50 p-3">
              <span class="text-muted">Objektivi</span>
              <strong class="mt-1 block text-highlighted">{{
                goalLabels[slot.algorithmGoal]
              }}</strong>
            </div>
            <div class="rounded-lg bg-elevated/50 p-3">
              <span class="text-muted">Drejtimi vizual</span>
              <strong class="mt-1 block capitalize text-highlighted">{{
                slot.visualLayout
              }}</strong>
            </div>
          </div>

          <div
            v-if="slot.requiredAssetId && assetMap.get(slot.requiredAssetId)"
            class="mt-4 flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3"
          >
            <MediaImage
              :src="assetMap.get(slot.requiredAssetId)!.url"
              :alt="assetMap.get(slot.requiredAssetId)!.name"
              class="size-12 shrink-0 rounded-lg object-cover"
              width="48"
              height="48"
            />
            <div class="min-w-0">
              <span class="text-xs text-muted">Fotografi e zgjedhur nga ti</span>
              <strong class="block truncate text-sm text-highlighted">{{
                assetMap.get(slot.requiredAssetId)!.name
              }}</strong>
            </div>
          </div>

          <details class="mt-4 rounded-xl border border-default px-3.5 py-3">
            <summary class="cursor-pointer text-sm font-medium text-highlighted">
              Pse ky kanal dhe ky orar?
            </summary>
            <div class="mt-3 space-y-2 text-xs leading-5 text-muted">
              <p>{{ slot.platformRationale }}</p>
              <p>{{ slot.timingRationale }}</p>
              <p><strong class="text-toned">Fotografia:</strong> {{ slot.assetDirection }}</p>
            </div>
          </details>
        </article>
      </div>
    </section>
  </div>
</template>
