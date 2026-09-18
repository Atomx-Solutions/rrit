import { createHash } from 'node:crypto'
import {
  editorialPlanSchema,
  type Research,
} from '../../shared/schemas/monthly-plan'
import type { Workspace } from '../../shared/schemas/workspace'
import { dayInZone } from '../../shared/utils/calendar'
import { zonedToIso } from '../../shared/utils/format'
import { factIsUsable } from '../../shared/schemas/business-brain'

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
export function plannerPrerequisites(
  workspace: Workspace,
  now = new Date(),
  month = planningMonth(workspace.preferences.timezone, now),
): PlannerPrerequisite[] {
  const start = `${month}-01`
  const end = `${month}-${new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()}`
  const today = dayInZone(now, workspace.preferences.timezone)
  const earliest = start > today ? start : today
  const facts = workspace.brand.facts.filter((fact) => {
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
    const candidate = workspace.brand.facts.find(
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
  if (!workspace.assets.some((asset) => asset.rights && !asset.generated))
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
  photoSelection: { mode: 'auto' | 'selected'; selectedAssetIds: string[] } = {
    mode: 'auto',
    selectedAssetIds: [],
  },
) {
  const start = `${month}-01`
  const end = `${month}-${new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()}`
  const today = dayInZone(now, workspace.preferences.timezone)
  const earliest = start > today ? start : today
  const facts = workspace.brand.facts.filter((fact) => {
    const day = fact.validFrom && fact.validFrom > earliest ? fact.validFrom : earliest
    return day <= end && factIsUsable(fact, day)
  })
  const assets = workspace.assets.filter((asset) => asset.rights && !asset.generated)
  const missing = plannerPrerequisites(workspace, now, month)
  if (missing.length)
    throw new PlannerFailure(
      missing[0]!.code,
      missing.map((item) => item.id),
    )
  const eligibleAssetIds = new Set(assets.map((asset) => asset.id))
  const selectedAssetIds = [...new Set(photoSelection.selectedAssetIds)]
  if (
    photoSelection.mode === 'selected' &&
    (!selectedAssetIds.length || selectedAssetIds.some((id) => !eligibleAssetIds.has(id)))
  )
    throw new PlannerFailure('PHOTO_SELECTION_CHANGED')
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]))
  const generationAssets =
    photoSelection.mode === 'selected'
      ? selectedAssetIds.map((id) => assetsById.get(id)!)
      : assets
  const evidence = {
    brand: { ...workspace.brand, facts },
    timezone: workspace.preferences.timezone,
    // In selected mode this is an allow-list, not merely a preference. Keeping
    // unselected gallery assets out of evidence prevents downstream stages from
    // silently choosing them.
    assets: generationAssets.slice(0, 40).map(({ id, name, tags }) => ({ id, name, tags })),
    photoSelection: {
      mode: photoSelection.mode,
      selectedAssetIds: photoSelection.mode === 'selected' ? selectedAssetIds : [],
    },
    recentPosts: workspace.posts
      .slice(0, 30)
      .map(({ title, caption, channel }) => ({ title, caption: caption.slice(0, 600), channel })),
    capturedAt: now.toISOString(),
  }
  if (Buffer.byteLength(JSON.stringify(evidence)) > 48000)
    throw new PlannerFailure('EVIDENCE_TOO_LARGE')
  return evidence
}
export type PlannerEvidence = ReturnType<typeof plannerEvidence>
export function planningMonth(timezone: string, now = new Date()) {
  return dayInZone(now, timezone).slice(0, 7)
}
export function earliestPlanningDate(timezone: string, capturedAt: string) {
  const date = new Date(`${dayInZone(capturedAt, timezone)}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}
function canonicalSourceUrl(value: string) {
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
        'Kjo orë është hipotezë editoriale dhe duhet verifikuar me Insights.',
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

// Provider output can contain a structurally valid but mistyped identifier or
// an extra slot. Repair only machine-verifiable contract details here; the
// editorial meaning still has to pass validateEditorialPlan below.
export function normalizeEditorialPlanResponse(
  value: unknown,
  evidence: PlannerEvidence,
  research: Research,
  count: number,
) {
  const plan = editorialPlanSchema.parse(value)
  const knownFacts = new Set(evidence.brand.facts.map((fact) => fact.id))
  const sourceByCanonicalUrl = new Map(
    research.sources.map((source) => [canonicalSourceUrl(source.url), source.url]),
  )
  const selectedAssets = new Set(evidence.photoSelection?.selectedAssetIds || [])

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
      return {
        ...slot,
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
) {
  const plan = editorialPlanSchema.parse(value)
  const earliestDate = earliestPlanningDate(evidence.timezone, evidence.capturedAt)
  const days = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
  ).getUTCDate()
  const facts = new Map(evidence.brand.facts.map((fact) => [fact.id, fact]))
  const sources = new Set(research.sources.map((source) => canonicalSourceUrl(source.url)))
  const used = new Set<string>()
  const topics = new Set<string>()
  const hooks = new Set<string>()
  const pillars = new Set<string>()
  const intents = new Map<string, number>()
  const layouts = new Map<string, number>()
  const algorithmGoals = new Map<string, number>()
  const requiredAssets = new Map<string, number>()
  const photoSelection = evidence.photoSelection || { mode: 'auto' as const, selectedAssetIds: [] }
  const selectedAssets = new Set(photoSelection.selectedAssetIds)
  if (plan.slots.length !== count) throw new PlannerFailure('INVALID_SLOT_COUNT')
  for (const [index, slot] of plan.slots.entries()) {
    const key = `${slot.day}:${slot.time}:${slot.channel}`
    const date = `${month}-${String(slot.day).padStart(2, '0')}T${slot.time}`
    const topic = normalizedIdea(slot.topic)
    const hook = normalizedIdea(slot.hook)
    if (slot.day > days)
      throw new PlannerFailure('INVALID_SLOT_DATE', [`Postimi ${index + 1}: dita ${slot.day} nuk ekziston në muaj.`])
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
    const iso = zonedToIso(date, evidence.timezone)
    if (
      !iso ||
      date.slice(0, 10) < earliestDate ||
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
      requiredAssets.set(slot.requiredAssetId, (requiredAssets.get(slot.requiredAssetId) || 0) + 1)
  }
  const minimumIntents = Math.min(count, count >= 10 ? 5 : count >= 6 ? 4 : count >= 3 ? 3 : count)
  const minimumLayouts = Math.min(count, count >= 10 ? 5 : count >= 6 ? 4 : count >= 3 ? 3 : count)
  if (
    intents.size < minimumIntents ||
    layouts.size < minimumLayouts ||
    algorithmGoals.size < Math.min(count, count >= 6 ? 4 : count) ||
    (count >= 6 && pillars.size < 3) ||
    Math.max(...intents.values()) > Math.ceil(count * 0.4) ||
    Math.max(...layouts.values()) > Math.ceil(count * 0.35)
  )
    throw new PlannerFailure('REPETITIVE_PLAN', [
      `Shpërndaji ${count} postimet në të paktën ${minimumIntents} intent-e dhe ${minimumLayouts} layout-e, pa dominuar njëri ritmin mujor.`,
    ])
  if (
    photoSelection.mode === 'selected' &&
    [...selectedAssets].some((id) => requiredAssets.get(id) !== 1)
  )
    throw new PlannerFailure('PHOTO_SELECTION_MISSING', [
      `Caktoje secilën fotografi të zgjedhur ekzaktësisht një herë: ${[...selectedAssets].join(', ')}.`,
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
  LEGACY_PHOTO_SELECTION_CHANGED:
    'NjÃ« fotografi e zgjedhur nuk Ã«shtÃ« mÃ« e disponueshme ose nuk i ka tÃ« drejtat aktive.',
  LEGACY_PHOTO_SELECTION_MISSING:
    'Strategjia nuk i caktoi tÃ« gjitha fotografitÃ« e zgjedhura. Plani duhet korrigjuar.',
  LEGACY_TOO_MANY_SELECTED_PHOTOS:
    'Ke zgjedhur mÃ« shumÃ« fotografi sesa postime lejon plani i kÃ«tij muaji.',
  PHOTO_PREFERENCE_REQUIRED:
    'Zgjidh nÃ«se fotografitÃ« do t\'i caktojÃ« AI apo do t\'i zgjedhÃ«sh vetÃ«.',
  PHOTO_SELECTION_CHANGED:
    'NjÃ« fotografi e zgjedhur nuk Ã«shtÃ« mÃ« e disponueshme ose nuk i ka tÃ« drejtat aktive.',
  PHOTO_SELECTION_MISSING:
    'Strategjia nuk i caktoi tÃ« gjitha fotografitÃ« e zgjedhura. Plani duhet korrigjuar.',
  TOO_MANY_SELECTED_PHOTOS:
    'Ke zgjedhur mÃ« shumÃ« fotografi sesa postime lejon plani i kÃ«tij muaji.',
  PLAN_RESET_UNSAFE:
    'Plani ka postime tÃ« miratuara ose tÃ« publikuara dhe nuk mund tÃ« pastrohet automatikisht.',
  BUDGET_ESTIMATE_EXCEEDED:
    'Kostoja e shërbimit tejkaloi rezervimin. Platforma duhet të rishikojë kufijtë përpara vazhdimit.',
}

/**
 * Posts the package still allows this month (3 / 14 / 30 / 60). With Pako 1
 * and 14 posts created it returns 0, so the 15th generation is blocked.
 */
export function remainingMonthlyPosts(postsPerMonth: number, createdThisMonth: number) {
  return Math.max(0, Math.min(postsPerMonth, 100) - createdThisMonth)
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
