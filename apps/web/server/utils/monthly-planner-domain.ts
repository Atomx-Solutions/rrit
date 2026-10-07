import { createHash } from 'node:crypto'
import {
  editorialPlanSchema,
  type Research,
  type SlotBrief,
} from '../../shared/schemas/monthly-plan'
import type { Workspace } from '../../shared/schemas/workspace'
import { dayInZone } from '../../shared/utils/calendar'
import { zonedToIso } from '../../shared/utils/format'
import {
  emptyPlannerBrain,
  factIsUsable,
  mergeBrandFacts,
  offerIsUsable,
  profileGuardrailIdPrefix,
  type BrandFact,
  type PlannerBrain,
  type PlannerBrainOffer,
} from '../../shared/schemas/business-brain'

// The platforms a post may be planned for.
export const plannerChannels = ['Instagram', 'Facebook'] as const
export type PlannerChannel = (typeof plannerChannels)[number]
// How many of a batch's posts each platform gets. An empty object is the
// absence of a request, not a request for nothing.
export type PlannerChannelCounts = Partial<Record<PlannerChannel, number>>

export function channelCountsTotal(counts: PlannerChannelCounts | undefined) {
  return plannerChannels.reduce((total, channel) => total + (counts?.[channel] || 0), 0)
}
/**
 * The distribution a request asked for, or nothing.
 *
 * A distribution is only meaningful when it accounts for exactly the posts
 * being requested, so a partial or oversized one is rejected here rather than
 * half-applied by the planner.
 */
export function normalizedChannelCounts(
  counts: PlannerChannelCounts | undefined,
  quantity: number,
): PlannerChannelCounts {
  if (!counts) return {}
  const entries = plannerChannels.flatMap((channel) => {
    const value = counts[channel]
    if (value === undefined) return []
    if (!Number.isInteger(value) || value < 0) throw new PlannerFailure('INVALID_CHANNEL_SPLIT')
    return value > 0 ? ([[channel, value]] as const) : []
  })
  if (!entries.length) return {}
  const asked = entries.reduce((total, [, value]) => total + value, 0)
  if (asked !== quantity) throw new PlannerFailure('INVALID_CHANNEL_SPLIT')
  return Object.fromEntries(entries) as PlannerChannelCounts
}
/** The single platform a distribution leaves, when it leaves only one. */
export function soleChannel(counts: PlannerChannelCounts | undefined) {
  const used = plannerChannels.filter((channel) => (counts?.[channel] || 0) > 0)
  return used.length === 1 ? used[0]! : undefined
}

export class PlannerFailure extends Error {
  constructor(
    public readonly code: string,
    public readonly details: string[] = [],
  ) {
    super(code)
  }
}
export function evidenceHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
export type PlannerPrerequisite = {
  id: 'industry' | 'audience' | 'fact-text' | 'fact-source' | 'fact-confirmation' | 'owned-photo'
  code: string
  label: string
  description: string
}
export type PlannerTimingSample = {
  source: 'facebook' | 'instagram' | 'platform'
  channel: 'Facebook' | 'Instagram'
  publishedAt: string
}
export function plannerPrerequisites(
  workspace: Workspace,
  now = new Date(),
  month = planningMonth(workspace.preferences.timezone, now),
  // Verified Business Brain facts satisfy the requirement exactly like profile
  // facts: which of the two editors the business typed them into is not its
  // problem.
  brainFacts: BrandFact[] = [],
): PlannerPrerequisite[] {
  const start = `${month}-01`
  const end = `${month}-${new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()}`
  const today = dayInZone(now, workspace.preferences.timezone)
  const earliest = start > today ? start : today
  const knownFacts = mergeBrandFacts(workspace.brand.facts, brainFacts)
  const facts = knownFacts.filter((fact) => {
    const day = fact.validFrom && fact.validFrom > earliest ? fact.validFrom : earliest
    return day <= end && factIsUsable(fact, day)
  })
  const missing: PlannerPrerequisite[] = []
  if (!workspace.brand.industry.trim())
    missing.push({
      id: 'industry',
      code: 'BUSINESS_CONTEXT_REQUIRED',
      label: 'Lloji i biznesit',
      description: 'Te Profili i biznesit, plotëso fushën “Lloji i biznesit”.',
    })
  if (!workspace.brand.audience.trim())
    missing.push({
      id: 'audience',
      code: 'BUSINESS_CONTEXT_REQUIRED',
      label: 'Audienca e biznesit',
      description:
        'Te Profili i biznesit, plotëso fushën “Për kë janë produktet ose shërbimet e tua?”.',
    })
  if (!facts.length) {
    const candidate = knownFacts.find(
      (fact) => !fact.validFrom || fact.validFrom <= end,
    )
    if (!candidate || !candidate.text.trim())
      missing.push({
        id: 'fact-text',
        code: 'VERIFIED_FACTS_REQUIRED',
        label: 'Teksti i detajit të biznesit',
        description:
          'Te “Detaje që postimet duhet t’i kenë të sakta”, shkruaj informacionin që AI mund ta përdorë.',
      })
    if (!candidate || !candidate.source.trim())
      missing.push({
        id: 'fact-source',
        code: 'VERIFIED_FACTS_REQUIRED',
        label: 'Burimi i detajit',
        description:
          'Te i njëjti detaj, plotëso fushën “Burimi” për të treguar nga vjen informacioni.',
      })
    if (!candidate || !candidate.verified)
      missing.push({
        id: 'fact-confirmation',
        code: 'VERIFIED_FACTS_REQUIRED',
        label: 'Konfirmimi i detajit',
        description:
          'Te i njëjti detaj, aktivizo “E kam kontrolluar këtë informacion” dhe ruaj identitetin.',
      })
  }
  if (!workspace.assets.some((asset) => asset.kind === 'photo' && asset.rights && !asset.generated))
    missing.push({
      id: 'owned-photo',
      code: 'OWNED_PHOTOS_REQUIRED',
      label: 'Fotografi reale me të drejta të konfirmuara',
      description:
        'Te Galeria, ngarko një fotografi të biznesit dhe konfirmo të drejtat e përdorimit.',
    })
  return missing
}
export function plannerEvidence(
  workspace: Workspace,
  now = new Date(),
  month = planningMonth(workspace.preferences.timezone, now),
  photoSelection: {
    mode: 'auto' | 'selected'
    selectedAssetIds: string[]
    selectedVideoAssetIds?: string[]
  } = {
    mode: 'auto',
    selectedAssetIds: [],
  },
  timingSamples: PlannerTimingSample[] = [],
  businessBrain: { brain?: PlannerBrain; facts?: BrandFact[] } = {},
) {
  const brain = businessBrain.brain || emptyPlannerBrain
  const brainFacts = businessBrain.facts || []
  const start = `${month}-01`
  const end = `${month}-${new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()}`
  const today = dayInZone(now, workspace.preferences.timezone)
  const earliest = start > today ? start : today
  const facts = mergeBrandFacts(workspace.brand.facts, brainFacts).filter((fact) => {
    const day = fact.validFrom && fact.validFrom > earliest ? fact.validFrom : earliest
    return day <= end && factIsUsable(fact, day)
  })
  const assets = workspace.assets.filter(
    (asset) => asset.kind === 'photo' && asset.rights && !asset.generated,
  )
  const missing = plannerPrerequisites(workspace, now, month, brainFacts)
  if (missing.length)
    throw new PlannerFailure(
      missing[0]!.code,
      missing.map((item) => item.id),
    )
  const eligibleAssetIds = new Set(assets.map((asset) => asset.id))
  const selectedAssetIds = [...new Set(photoSelection.selectedAssetIds)]
  // Photographs chosen for motion are tracked apart from the feed selection,
  // but the two lists may overlap: a photograph chosen for both produces one
  // feed post and one video from the same source.
  const selectedVideoAssetIds = [...new Set(photoSelection.selectedVideoAssetIds || [])]
  if (
    photoSelection.mode === 'selected' &&
    (!selectedAssetIds.length ||
      [...selectedAssetIds, ...selectedVideoAssetIds].some((id) => !eligibleAssetIds.has(id)))
  )
    throw new PlannerFailure('PHOTO_SELECTION_CHANGED')
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]))
  const generationAssets =
    photoSelection.mode === 'selected'
      ? [...new Set([...selectedAssetIds, ...selectedVideoAssetIds])].map(
          (id) => assetsById.get(id)!,
        )
      : assets
  const localTimingSamples = workspace.posts
    // A video is watched on its own rhythm whichever channel it reached, so it
    // is no evidence of when a feed post should go out.
    .filter((post) => post.status === 'published' && post.publishedAt && !post.video)
    .map((post) => ({
      source: 'platform' as const,
      channel: post.channel as PlannerChannel,
      publishedAt: post.publishedAt!,
    }))
  const observedTiming = [...timingSamples, ...localTimingSamples]
    .filter((sample) => Number.isFinite(Date.parse(sample.publishedAt)))
    .slice(0, 240)
  // Business Brain is frozen into the snapshot exactly like the brand facts.
  // Offers whose window cannot overlap this month are dropped here so no later
  // stage can reach for one that was never publishable.
  //
  // The brand profile still carries a voice and a guardrail list of its own
  // from the older editor. They are reconciled here so the stages never see
  // two answers to the same question: the Business Brain voice wins because it
  // is the versioned one, while guardrails are unioned because dropping a
  // prohibition is worse than repeating one.
  const legacyGuardrails = (workspace.brand.guardrails || [])
    .map((text) => text.trim())
    .filter(Boolean)
    .filter((text) => !brain.guardrails.some((guardrail) => guardrail.text.trim() === text))
  const brainForMonth: PlannerBrain = {
    ...brain,
    voice: plannerVoice(brain, workspace.brand),
    offers: brain.offers.filter(
      (offer) => offer.validFrom <= end && (!offer.validUntil || offer.validUntil >= earliest),
    ),
    guardrails: [
      ...brain.guardrails,
      ...legacyGuardrails.map((text, index) => ({
        id: `${profileGuardrailIdPrefix}${index}`,
        text,
        source: 'Profili i biznesit',
      })),
    ],
  }
  const evidence = {
    brand: { ...workspace.brand, facts, voice: brainForMonth.voice },
    brain: brainForMonth,
    timezone: workspace.preferences.timezone,
    // In selected mode this is an allow-list, not merely a preference. Keeping
    // unselected gallery assets out of evidence prevents downstream stages from
    // silently choosing them.
    assets: generationAssets.slice(0, 40).map(({ id, name, tags }) => ({ id, name, tags })),
    photoSelection: {
      mode: photoSelection.mode,
      selectedAssetIds: photoSelection.mode === 'selected' ? selectedAssetIds : [],
      selectedVideoAssetIds: photoSelection.mode === 'selected' ? selectedVideoAssetIds : [],
    },
    recentPosts: workspace.posts
      .slice(0, 30)
      .map(({ title, caption, channel }) => ({ title, caption: caption.slice(0, 600), channel })),
    timingEvidence: {
      total: observedTiming.length,
      socialHistory: observedTiming.filter((sample) => sample.source !== 'platform').length,
      platformHistory: observedTiming.filter((sample) => sample.source === 'platform').length,
      samples: observedTiming,
    },
    capturedAt: now.toISOString(),
  }
  // Business Brain has its own budget rather than competing with the rest of
  // the snapshot: its size is already bounded by the limits the editor
  // enforces, and a business that fills that editor to the maximum must not
  // find itself unable to generate.
  if (Buffer.byteLength(JSON.stringify({ ...evidence, brain: undefined })) > 48000)
    throw new PlannerFailure('EVIDENCE_TOO_LARGE')
  if (Buffer.byteLength(JSON.stringify(brainForMonth)) > 96000)
    throw new PlannerFailure('EVIDENCE_TOO_LARGE')
  return evidence
}
export type PlannerEvidence = ReturnType<typeof plannerEvidence>

/**
 * The one voice generation uses.
 *
 * Business Brain versions its voice, so it wins over the brand-profile field
 * whenever it has one. Both the snapshot and the drift check derive the value
 * here, so they can never disagree about which of the two editors spoke last.
 */
export function plannerVoice(brain: PlannerBrain, brand: { voice: string }) {
  return brain.voice.trim() || brand.voice
}

/** The Business Brain a plan carries, tolerating plans snapshotted before it existed. */
export function plannerBrainOf(evidence: { brain?: PlannerBrain }): PlannerBrain {
  return evidence.brain || emptyPlannerBrain
}

/**
 * The snapshot as a prompt sees it.
 *
 * Business Brain is stored inside the evidence so that it is frozen and
 * hashed with everything else, but each stage receives it separately at the
 * width that stage needs. Sending the stored copy as well would put the whole
 * brain back into every per-post call and undo that narrowing.
 */
export function promptEvidence(evidence: PlannerEvidence) {
  const { brain: _brain, ...rest } = evidence as PlannerEvidence & { brain?: PlannerBrain }
  return rest
}

/**
 * What a single post is allowed to see.
 *
 * Planning decides the whole month and therefore receives every section in
 * full. Content and quality run once per post, so they receive only the
 * audience and offer that planning assigned to that slot: sending ten offers
 * to a post about one offer invites the model to mix them. Guardrails and the
 * voice are never narrowed — they apply to every post equally.
 */
export function brainForSlot(
  brain: PlannerBrain,
  slot: { audienceId?: string | null; offerId?: string | null },
  day: string,
) {
  const audience = slot.audienceId
    ? brain.audiences.find((item) => item.id === slot.audienceId) || null
    : null
  const selected = slot.offerId
    ? brain.offers.find((item) => item.id === slot.offerId) || null
    : null
  return {
    voice: brain.voice,
    guardrails: brain.guardrails,
    audience,
    // A slot keeps its offer only while the business's own window still covers
    // the publication day.
    offer: selected && offerIsUsable(selected, day) ? selected : null,
  }
}
export function planningMonth(timezone: string, now = new Date()) {
  return dayInZone(now, timezone).slice(0, 7)
}
export function earliestPlanningDate(timezone: string, capturedAt: string) {
  const date = new Date(`${dayInZone(capturedAt, timezone)}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}
/**
 * The calendar days of `month` that a package actually covers.
 *
 * A custom package is negotiated between two dates rather than along calendar
 * months, so a month may be covered only in part. Returns the intersection, or
 * the plain month when the plan has no package window of its own.
 */
export function packageMonthWindow(
  month: string,
  quotaPeriod: { startsAt: Date; endsAt: Date } | undefined,
) {
  const monthStart = `${month}-01`
  const monthEnd = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
    .toISOString()
    .slice(0, 10)
  if (!quotaPeriod) return { from: monthStart, to: monthEnd, bounded: false as const }
  const packageStart = quotaPeriod.startsAt.toISOString().slice(0, 10)
  // `endsAt` is the exclusive end of the paid period, so the last covered day
  // is the one before it.
  const packageEnd = new Date(quotaPeriod.endsAt.getTime() - 1).toISOString().slice(0, 10)
  return {
    from: packageStart > monthStart ? packageStart : monthStart,
    to: packageEnd < monthEnd ? packageEnd : monthEnd,
    bounded: true as const,
  }
}

/**
 * The window the monthly research may look for dated events inside.
 *
 * It is the part of the month that is both paid for and still publishable, so
 * research never spends a paid call on an occasion no post could reach: a
 * package bought on 30 October and valid to 30 November makes November's
 * holidays researchable, while a December occasion is outside what the customer
 * bought. Returns null when nothing of the month remains.
 */
export function eventResearchWindow(
  month: string,
  quotaPeriod: { startsAt: Date; endsAt: Date } | undefined,
  timezone: string,
  capturedAt: string,
) {
  const covered = packageMonthWindow(month, quotaPeriod)
  const earliest = earliestPlanningDate(timezone, capturedAt)
  const from = covered.from > earliest ? covered.from : earliest
  if (from > covered.to) return null
  return { from, to: covered.to }
}

// Search results arrive with tracking parameters the model does not always
// repeat verbatim, so every comparison between a cited URL and a returned
// source goes through this rather than matching the raw strings.
export function canonicalSourceUrl(value: string) {
  const url = new URL(value)
  url.hash = ''
  for (const key of [...url.searchParams.keys()])
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key)
  url.searchParams.sort()
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '')
  return url.toString()
}
const fallbackIntents = [
  'educate',
  'inspire',
  'trust',
  'conversation',
  'product',
  'behind_the_scenes',
  'local_relevance',
  'conversion',
] as const
// Plans created before the art-direction contract can still finish after a
// deployment. New provider responses always pass the strict schema below.
export function parsePersistedEditorialPlan(value: unknown) {
  const candidate = value as { slots?: Array<Record<string, unknown>> }
  if (!candidate?.slots || !Array.isArray(candidate.slots)) return editorialPlanSchema.parse(value)
  return editorialPlanSchema.parse({
    ...(value as object),
    slots: candidate.slots.map((slot, index) => ({
      ...slot,
      intent: slot.intent || fallbackIntents[index % fallbackIntents.length],
      hook: slot.hook || slot.topic || 'Kënd editorial i verifikuar',
      assetDirection:
        slot.assetDirection ||
        'Zgjidh fotografinë më të përshtatshme për temën dhe ruaj subjektin.',
      visualLayout:
        slot.visualLayout ||
        slot.assetDirection ||
        `Drejtim vizual origjinal i përshtatur për idenë editoriale ${index + 1}.`,
      requiredAssetId: slot.requiredAssetId || null,
      algorithmGoal:
        slot.algorithmGoal ||
        ['saves', 'shares', 'meaningful_comments', 'profile_actions'][index % 4],
      platformRationale:
        slot.platformRationale ||
        'Përshtate formatin dhe mesazhin me sjelljen e audiencës në kanal.',
      timingRationale:
        slot.timingRationale ||
        'Nuk ka të dhëna të vëzhguara për këtë orë; platforma nuk e paraqet si orar optimal.',
    })),
  })
}
function normalizedIdea(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function observedTimingHour(
  sample: PlannerTimingSample,
  timezone: string,
) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(sample.publishedAt))
      .map((part) => [part.type, part.value]),
  )
  return parts.hour
}

// Provider output can contain a structurally valid but mistyped identifier or
// an extra slot. Repair only machine-verifiable contract details here; the
function offerIdForSlot(
  offers: Map<string, PlannerBrainOffer>,
  slot: { offerId?: string | null; day: number },
  month?: string,
) {
  if (!slot.offerId) return null
  const offer = offers.get(slot.offerId)
  if (!offer) return null
  if (!month) return offer.id
  return offerIsUsable(offer, `${month}-${String(slot.day).padStart(2, '0')}`) ? offer.id : null
}
// editorial meaning still has to pass validateEditorialPlan below.
export function normalizeEditorialPlanResponse(
  value: unknown,
  evidence: PlannerEvidence,
  research: Research,
  count: number,
  month?: string,
  // How this batch's posts were split across platforms. A split that leaves a
  // single platform has no judgement left in it, so it is applied rather than
  // rejected: blocking a paid plan over a field the request already decided
  // helps nobody.
  channelCounts: PlannerChannelCounts = {},
) {
  const plan = editorialPlanSchema.parse(value)
  const knownFacts = new Set(evidence.brand.facts.map((fact) => fact.id))
  const brain = plannerBrainOf(evidence)
  const knownAudiences = new Set(brain.audiences.map((audience) => audience.id))
  const monthOffers = new Map(brain.offers.map((offer) => [offer.id, offer]))
  const sourceByCanonicalUrl = new Map(
    research.sources.map((source) => [canonicalSourceUrl(source.url), source.url]),
  )
  const selectedAssets = new Set([
    ...(evidence.photoSelection?.selectedAssetIds || []),
    ...(evidence.photoSelection?.selectedVideoAssetIds || []),
  ])
  const timingEvidence = evidence.timingEvidence || { samples: [] }

  function supportedTimingBasis(slot: { timingBasis?: 'social_history' | 'platform_history' | 'no_data'; channel: string; time: string }) {
    if (slot.timingBasis === 'no_data' || !slot.timingBasis) return 'no_data' as const
    const samples = timingEvidence.samples.filter((sample) =>
      slot.timingBasis === 'platform_history'
        ? sample.source === 'platform' && sample.channel === slot.channel
        : sample.source !== 'platform' && sample.channel === slot.channel,
    )
    return samples.some(
      (sample) => observedTimingHour(sample, evidence.timezone) === slot.time.slice(0, 2),
    )
      ? slot.timingBasis
      : ('no_data' as const)
  }

  return {
    ...plan,
    slots: plan.slots.slice(0, count).map((slot) => {
      const verifiedFactIds = [...new Set(slot.factIds.filter((id) => knownFacts.has(id)))]
      const verifiedSourceUrls = [
        ...new Set(
          slot.sourceUrls.flatMap((url) => {
            const verified = sourceByCanonicalUrl.get(canonicalSourceUrl(url))
            return verified ? [verified] : []
          }),
        ),
      ]
      const timingBasis = supportedTimingBasis(slot)
      return {
        ...slot,
        // With one platform requested there is nothing to decide, so the
        // request wins outright.
        channel: soleChannel(channelCounts) || slot.channel,
        // Never replace an editorial claim with an unrelated fact or source.
        // Keeping the original when nothing matches makes validation request a
        // precise model correction instead of silently weakening grounding.
        factIds: verifiedFactIds.length ? verifiedFactIds : slot.factIds,
        sourceUrls: verifiedSourceUrls.length ? verifiedSourceUrls : slot.sourceUrls,
        requiredAssetId:
          evidence.photoSelection?.mode === 'selected' &&
          slot.requiredAssetId &&
          selectedAssets.has(slot.requiredAssetId)
            ? slot.requiredAssetId
            : null,
        // Timing evidence is mechanically verifiable. If the model labels an
        // hour as observed but no matching record exists, downgrade it to the
        // truthful no-data state instead of blocking an otherwise safe plan.
        timingBasis,
        timingRationale:
          timingBasis === 'no_data' && slot.timingBasis && slot.timingBasis !== 'no_data'
            ? 'Nuk ka të dhëna të vëzhguara për këtë orë; orari mbetet për t’u testuar pa pretenduar optimalitet.'
            : slot.timingRationale,
        // Keep a Business Brain reference only when it names a row the
        // business actually has. An offer additionally has to be valid on the
        // day this slot publishes, so an expired price can never be planned.
        audienceId:
          slot.audienceId && knownAudiences.has(slot.audienceId) ? slot.audienceId : null,
        offerId: offerIdForSlot(monthOffers, slot, month),
      }
    }),
  }
}
export function validateEditorialPlan(
  value: unknown,
  evidence: PlannerEvidence,
  research: Research,
  month: string,
  count: number,
  latestDate?: string,
  // Slots planned by earlier batches of the same month. A new batch must not
  // collide with their dates or repeat their ideas, so they seed the
  // uniqueness checks without being revalidated themselves.
  existingSlots: SlotBrief[] = [],
  channelCounts: PlannerChannelCounts = {},
  videoSlots = 0,
) {
  const plan = editorialPlanSchema.parse(value)
  const earliestDate = earliestPlanningDate(evidence.timezone, evidence.capturedAt)
  const days = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
  ).getUTCDate()
  const facts = new Map(evidence.brand.facts.map((fact) => [fact.id, fact]))
  const sources = new Set(research.sources.map((source) => canonicalSourceUrl(source.url)))
  const used = new Set(
    existingSlots.map((slot) => `${slot.day}:${slot.time}:${slot.channel}`),
  )
  const topics = new Set(existingSlots.map((slot) => normalizedIdea(slot.topic)))
  const hooks = new Set(existingSlots.map((slot) => normalizedIdea(slot.hook)))
  const pillars = new Set<string>()
  const intents = new Map<string, number>()
  const layouts = new Map<string, number>()
  const algorithmGoals = new Map<string, number>()
  const requiredPostAssets = new Map<string, number>()
  const requiredVideoAssets = new Map<string, number>()
  const photoSelection = evidence.photoSelection || { mode: 'auto' as const, selectedAssetIds: [] }
  const postAssets = new Set(photoSelection.selectedAssetIds)
  const videoAssets = new Set(photoSelection.selectedVideoAssetIds || [])
  const selectedAssets = new Set([...postAssets, ...videoAssets])
  const timingEvidence = evidence.timingEvidence || {
    samples: [],
    socialHistory: 0,
    platformHistory: 0,
  }
  if (plan.slots.length !== count) throw new PlannerFailure('INVALID_SLOT_COUNT')
  for (const [index, slot] of plan.slots.entries()) {
    const key = `${slot.day}:${slot.time}:${slot.channel}`
    const date = `${month}-${String(slot.day).padStart(2, '0')}T${slot.time}`
    const topic = normalizedIdea(slot.topic)
    const hook = normalizedIdea(slot.hook)
    if (slot.day > days)
      throw new PlannerFailure('INVALID_SLOT_DATE', [`Postimi ${index + 1}: dita ${slot.day} nuk ekziston në muaj.`])
    // A video may go to any of the three channels, but a static feed post has
    // nowhere to land on TikTok, which publishes video only.
    if (slot.deliverable !== 'video' && !plannerChannels.includes(slot.channel as PlannerChannel))
      throw new PlannerFailure('UNGROUNDED_PLAN', [
        `Postimi ${index + 1}: ${slot.channel} pranon vetëm deliverable video; një postim statik duhet të shkojë te ${plannerChannels.join(' ose ')}.`,
      ])
    if (used.has(key))
      throw new PlannerFailure('REPETITIVE_PLAN', [`Postimi ${index + 1}: data, ora dhe kanali përsëriten.`])
    if (topics.has(topic) || hooks.has(hook))
      throw new PlannerFailure('REPETITIVE_PLAN', [`Postimi ${index + 1}: tema ose hook-u përsëritet.`])
    const invalidFactIds = slot.factIds.filter(
      (id) => !facts.has(id) || !factIsUsable(facts.get(id)!, date.slice(0, 10)),
    )
    if (invalidFactIds.length)
      throw new PlannerFailure('UNGROUNDED_PLAN', [
        `Postimi ${index + 1}: hiq ose korrigjo factIds të pavlefshme: ${invalidFactIds.join(', ')}. Përdor vetëm: ${[...facts.keys()].join(', ')}.`,
      ])
    const invalidSourceUrls = slot.sourceUrls.filter(
      (url) => !sources.has(canonicalSourceUrl(url)),
    )
    if (invalidSourceUrls.length)
      throw new PlannerFailure('UNGROUNDED_PLAN', [
        `Postimi ${index + 1}: përdor vetëm URL-të ekzakte nga research.sources. Të pavlefshme: ${invalidSourceUrls.join(', ')}.`,
      ])
    if (
      (slot.requiredAssetId && !selectedAssets.has(slot.requiredAssetId)) ||
      (photoSelection.mode === 'auto' && slot.requiredAssetId)
    )
      throw new PlannerFailure('UNGROUNDED_PLAN', [
        `Postimi ${index + 1}: requiredAssetId nuk përputhet me mënyrën e zgjedhjes së fotografive.`,
      ])
    const sourceSamples =
      slot.timingBasis === 'social_history'
        ? timingEvidence.samples.filter(
            (sample) => sample.source !== 'platform' && sample.channel === slot.channel,
          )
        : slot.timingBasis === 'platform_history'
          ? timingEvidence.samples.filter(
              (sample) => sample.source === 'platform' && sample.channel === slot.channel,
            )
          : []
    if (
      slot.timingBasis !== 'no_data' &&
      (!sourceSamples.length ||
        !sourceSamples.some(
          (sample) => observedTimingHour(sample, evidence.timezone) === slot.time.slice(0, 2),
        ))
    )
      throw new PlannerFailure('UNGROUNDED_PLAN', [
        `Postimi ${index + 1}: ora e deklaruar si e bazuar në të dhëna nuk përputhet me historikun real.`,
      ])
    const iso = zonedToIso(date, evidence.timezone)
    if (
      !iso ||
      date.slice(0, 10) < earliestDate ||
      (latestDate !== undefined && date.slice(0, 10) > latestDate) ||
      Date.parse(iso) <= Date.parse(evidence.capturedAt)
    )
      throw new PlannerFailure('INVALID_SLOT_DATE', [
        `Postimi ${index + 1}: përdor një datë pas ${earliestDate} brenda muajit ${month}.`,
      ])
    used.add(key)
    topics.add(topic)
    hooks.add(hook)
    pillars.add(normalizedIdea(slot.pillar))
    intents.set(slot.intent, (intents.get(slot.intent) || 0) + 1)
    layouts.set(slot.visualLayout, (layouts.get(slot.visualLayout) || 0) + 1)
    algorithmGoals.set(slot.algorithmGoal, (algorithmGoals.get(slot.algorithmGoal) || 0) + 1)
    if (slot.requiredAssetId)
      (slot.deliverable === 'video' ? requiredVideoAssets : requiredPostAssets).set(
        slot.requiredAssetId,
        ((slot.deliverable === 'video' ? requiredVideoAssets : requiredPostAssets).get(
          slot.requiredAssetId,
        ) || 0) + 1,
      )
  }
  const minimumIntents = Math.min(count, count >= 10 ? 5 : count >= 6 ? 4 : count >= 3 ? 3 : count)
  const minimumLayouts = Math.min(count, count >= 10 ? 5 : count >= 6 ? 4 : count >= 3 ? 3 : count)
  if (
    intents.size < minimumIntents ||
    layouts.size < minimumLayouts ||
    algorithmGoals.size < minimumIntents ||
    (count >= 6 && pillars.size < 3) ||
    Math.max(...intents.values()) > Math.ceil(count * 0.4) ||
    Math.max(...layouts.values()) > Math.ceil(count * 0.35)
  )
    throw new PlannerFailure('REPETITIVE_PLAN', [
      `Shpërndaji ${count} postimet në të paktën ${minimumIntents} intent-e dhe ${minimumLayouts} layout-e, pa dominuar njëri ritmin mujor.`,
    ])
  if (photoSelection.mode === 'selected') {
    if (
      [...postAssets].some((id) => requiredPostAssets.get(id) !== 1) ||
      [...videoAssets].some((id) => requiredVideoAssets.get(id) !== 1)
    )
      throw new PlannerFailure('PHOTO_SELECTION_MISSING', [
        `Cakto secilën fotografi të zgjedhur për postim ekzaktësisht një herë te një slot static_post (${[...postAssets].join(', ') || '—'}), dhe secilën të zgjedhur për video ekzaktësisht një herë te një slot video (${[...videoAssets].join(', ') || '—'}).`,
      ])
    const misplaced = plan.slots.some(
      (slot) =>
        !!slot.requiredAssetId &&
        !(slot.deliverable === 'video' ? videoAssets : postAssets).has(slot.requiredAssetId),
    )
    if (misplaced)
      throw new PlannerFailure('PHOTO_SELECTION_MISSING', [
        'Çdo slot duhet të përdorë një fotografi të zgjedhur pikërisht për llojin e tij.',
      ])
  }
  // The platform split the customer asked for is a promise about this batch,
  // so it is checked over the batch as a whole rather than slot by slot.
  if (channelCountsTotal(channelCounts)) {
    const planned = plan.slots.reduce<Record<string, number>>((totals, slot) => {
      if (slot.deliverable === 'video') return totals
      totals[slot.channel] = (totals[slot.channel] || 0) + 1
      return totals
    }, {})
    const wrong = plannerChannels.filter(
      (channel) => (planned[channel] || 0) !== (channelCounts[channel] || 0),
    )
    if (wrong.length)
      throw new PlannerFailure('UNGROUNDED_PLAN', [
        `Ndaji postimet sipas kërkesës: ${plannerChannels
          .map((channel) => `${channel} ${channelCounts[channel] || 0}`)
          .join(', ')}.`,
      ])
  }
  // The video count is a money boundary, not a style note: each video is a
  // deliverable the business bought, so the figure is enforced here rather than
  // trusted to the model. A surplus is demoted, because the slot is a complete
  // piece of work either way and discarding a batch already paid for would cost
  // the business more than the flag is worth. A shortfall cannot be repaired
  // the same way — a static slot has not been planned to carry motion — so it
  // is sent back for a replanning that honours the split. A surplus video slot is demoted instead of
  // failing the batch, because the slot is a complete static post either way and
  // discarding a batch the business already paid for would cost it more than the
  // flag is worth. A demoted slot simply reaches the business as the static post
  // it already is, which is why nothing extra has to be reported.
  let videosKept = 0
  for (const slot of plan.slots) {
    if (slot.deliverable !== 'video') continue
    if (videosKept < videoSlots) videosKept += 1
    else slot.deliverable = 'static_post'
  }
  if (videosKept < videoSlots)
    throw new PlannerFailure('UNGROUNDED_PLAN', [
      `Planifiko saktësisht ${videoSlots} slote si deliverable video, me fotografi të vetat; të tjerat si static_post.`,
    ])
  return plan
}
export const plannerMessages: Record<string, string> = {
  VERIFIED_FACTS_REQUIRED: 'Konfirmo faktet dhe burimet te profili i biznesit.',
  OWNED_PHOTOS_REQUIRED: 'Ngarko fotografi të biznesit dhe konfirmo të drejtat.',
  BUSINESS_CONTEXT_REQUIRED: 'Plotëso industrinë dhe audiencën te profili i biznesit.',
  CONFIGURATION_REQUIRED: 'Platforma ende nuk e ka aktivizuar planifikimin mujor.',
  ENTITLEMENT_REQUIRED: 'Planifikimi me AI kërkon një paketë aktive me AI.',
  QUOTA_EXCEEDED: 'Kufiri i paketës është arritur. Draftet e krijuara mbeten të ruajtura.',
  QUANTITY_EXCEEDS_REMAINING: 'Sasia e zgjedhur tejkalon postimet e mbetura në paketë.',
  VIDEO_QUANTITY_EXCEEDS_REMAINING: 'Sasia e videove tejkalon videot e mbetura në paketë.',
  VIDEO_DELIVERABLES_DISABLED: 'Aktivizo videot te profili i biznesit para se të kërkosh video.',
  BUDGET_EXCEEDED: 'Përgatitja u ndal te kufiri i kostos. Draftet mbeten të ruajtura.',
  PROVIDER_UNCERTAIN:
    'Lidhja me shërbimin AI u ndërpre. Platforma po vazhdon automatikisht nga e njëjta fazë.',
  PROVIDER_TEMPORARY:
    'Shërbimi AI pati një ndërprerje të përkohshme. Platforma po vazhdon automatikisht nga e njëjta fazë.',
  PROVIDER_RETRY_EXHAUSTED:
    'Shërbimi AI nuk u përgjigj pas riprovimeve të sigurta. Platforma duhet ta kontrollojë thirrjen përpara një prove tjetër.',
  PROVIDER_REQUEST_REJECTED:
    'Ofruesi AI nuk e pranoi formatin e kërkesës. Platforma duhet ta korrigjojë konfigurimin përpara vazhdimit.',
  PROVIDER_CREDIT_REQUIRED:
    'Krediti i ofruesit AI ka mbaruar. Mbush kreditin dhe rifillo planin; fotografitë dhe draftet mbeten të sigurta.',
  PROVIDER_RATE_LIMITED:
    'Ofruesi AI e kufizoi përkohësisht kërkesën. Provo rifillimin pas pak minutash.',
  RESEARCH_SOURCES_REQUIRED:
    'Hulumtimi nuk dha burime të verifikueshme. Muaji nuk u plotësua me të dhëna të sajuara.',
  EVIDENCE_CHANGED:
    'Faktet ose të drejtat e fotografive kanë ndryshuar. Kërkohet rishikim i planit.',
  QUALITY_BLOCKED: 'Kontrolli i cilësisë kërkon rishikim për këtë postim.',
  REPETITIVE_PLAN:
    'Plani përsëriti tema, intent ose kompozime. Kërkohet një kalendar më i larmishëm.',
  INVALID_SLOT_DATE:
    'Një orar i propozuar kishte kaluar. Platforma nuk ruan postime me orar të pavlefshëm.',
  INVALID_SLOT_COUNT: 'Plani nuk përmbante numrin e saktë të postimeve sipas paketës.',
  UNGROUNDED_PLAN: 'Plani nuk kaloi kontrollin e fakteve, burimeve ose larmisë së kërkuar.',
  PLAN_NOT_RESTARTABLE: 'Ky plan nuk mund të rifillohet në gjendjen aktuale.',
  PLAN_HAS_DRAFTS:
    'Ky plan ka tashmë drafte. Rishiko ose korrigjo draftet ekzistuese përpara një plani të ri.',
  PLAN_RECONCILIATION_REQUIRED:
    'Një thirrje e mëparshme e AI kërkon pajtim të kostos nga platforma përpara rifillimit.',
  PLANNER_PAUSED: 'Përgatitja automatike është në pauzë.',
  INVALID_CHANNEL_SPLIT: 'Ndarja sipas platformave duhet të mbulojë saktësisht numrin e postimeve të kërkuara.',
  LEGACY_PHOTO_SELECTION_CHANGED:
    'Një fotografi e zgjedhur nuk është më e disponueshme ose nuk i ka të drejtat aktive.',
  LEGACY_PHOTO_SELECTION_MISSING:
    'Strategjia nuk i caktoi të gjitha fotografitë e zgjedhura. Plani duhet korrigjuar.',
  LEGACY_TOO_MANY_SELECTED_PHOTOS:
    'Ke zgjedhur më shumë fotografi sesa postime lejon plani i këtij muaji.',
  PHOTO_PREFERENCE_REQUIRED:
    'Zgjidh nëse fotografitë do t\'i caktojë AI apo do t\'i zgjedhësh vetë.',
  PHOTO_SELECTION_CHANGED:
    'Një fotografi e zgjedhur nuk është më e disponueshme ose nuk i ka të drejtat aktive.',
  PHOTO_SELECTION_MISSING:
    'Strategjia nuk i caktoi të gjitha fotografitë e zgjedhura. Plani duhet korrigjuar.',
  TOO_MANY_SELECTED_PHOTOS:
    'Ke zgjedhur më shumë fotografi sesa postime lejon plani i këtij muaji.',
  PLAN_RESET_UNSAFE:
    'Plani ka postime të miratuara ose të publikuara dhe nuk mund të pastrohet automatikisht.',
  BUDGET_ESTIMATE_EXCEEDED:
    'Kostoja e shërbima bazohet i rezervimin. Platforma duhet të rishikojë kufijtë përpara vazhdimit.',
}

/**
 * Posts the package still allows this month (3 / 14 / 30 / 60). With Pako 1
 * and 14 posts created it returns 0, so the 15th generation is blocked.
 */
export function remainingMonthlyPosts(postsPerMonth: number, createdThisMonth: number) {
  return Math.max(0, Math.min(postsPerMonth, 100) - createdThisMonth)
}

/** Validates the client choice again at the server boundary. */
export function requestedPlannerPosts(quantity: number, remaining: number) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > remaining)
    throw new PlannerFailure('QUANTITY_EXCEEDS_REMAINING')
  return quantity
}

export function resumableContentFailureCode(code: string | null | undefined) {
  return [
    'QUALITY_BLOCKED',
    'UNGROUNDED_CONTENT',
    'GENERATION_FAILED',
    'PROVIDER_CREDIT_REQUIRED',
    'PROVIDER_RATE_LIMITED',
    'CONFIGURATION_REQUIRED',
    'PROVIDER_INCOMPLETE',
    'CREATIVE_TEXT_OVERFLOW',
    'CREATIVE_UNSUPPORTED_GLYPH',
    'CREATIVE_TOO_LARGE',
  ].includes(code || '')
}

/**
 * The only two canvas facts the creative pipeline depends on: the provider's
 * native portrait canvas and the final feed canvas the application crops to.
 * Everything the image prompt says about bleed and safe margins is derived from
 * these, so no percentage is restated as prose that could silently drift if
 * either canvas changes.
 */
export const feedCreativeCanvas = { width: 1080, height: 1350 } as const
export const providerCreativeCanvas = { width: 3, height: 4 } as const
/**
 * Editorial margin kept clear of critical content on every side of the final
 * canvas, as a share of that side. It is a design tunable, not a layout: it
 * constrains where critical content may live, never how a composition is built.
 */
export const criticalContentMargin = 0.09

function ratioLabel(canvas: { width: number; height: number }) {
  const divisor = (a: number, b: number): number => (b ? divisor(b, a % b) : a)
  const factor = divisor(canvas.width, canvas.height)
  return `${canvas.width / factor}:${canvas.height / factor}`
}

/**
 * Derives the composition contract for the centre crop performed by
 * normalizeGeneratedCreative. A provider canvas that is taller than the final
 * canvas loses height; one that is wider loses width. Percentages are expressed
 * against the provider canvas, because that is the surface the model paints.
 */
export function feedCreativeGeometry() {
  const providerAspect = providerCreativeCanvas.width / providerCreativeCanvas.height
  const finalAspect = feedCreativeCanvas.width / feedCreativeCanvas.height
  const retainedWidth = providerAspect > finalAspect ? finalAspect / providerAspect : 1
  const retainedHeight = providerAspect > finalAspect ? 1 : providerAspect / finalAspect
  const safeShare = 1 - criticalContentMargin * 2
  const percent = (value: number) => `${Math.round(value * 1000) / 10}%`
  return {
    finalPixels: `${feedCreativeCanvas.width}x${feedCreativeCanvas.height}`,
    finalRatio: ratioLabel(feedCreativeCanvas),
    providerRatio: ratioLabel(providerCreativeCanvas),
    discardedWidthPerSide: percent((1 - retainedWidth) / 2),
    discardedHeightPerSide: percent((1 - retainedHeight) / 2),
    safeWidth: percent(retainedWidth * safeShare),
    safeHeight: percent(retainedHeight * safeShare),
  }
}
