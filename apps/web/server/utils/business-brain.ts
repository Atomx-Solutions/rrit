import type { PoolClient } from 'pg'
import type { Workspace } from '../../shared/schemas/workspace'
import {
  audienceSchema,
  brandFactSchema,
  businessBrainFactSchema,
  businessBrainSchema,
  factInputProblem,
  guardrailSchema,
  offerSchema,
  sameFactContent,
  voiceVersionSchema,
  type BrandFact,
  type CreateFact,
  type CreateOffer,
  type UpdateFact,
} from '../../shared/schemas/business-brain'
import { evidenceHash } from './monthly-planner-domain'

type FactRow = Record<string, unknown> & { id: string; brand_id: string }
type VoiceRow = Record<string, unknown> & { id: string; brand_id: string }
type AudienceRow = Record<string, unknown> & { id: string; brand_id: string }
type OfferRow = Record<string, unknown> & { id: string; brand_id: string }
type GuardrailRow = Record<string, unknown> & { id: string; brand_id: string }

function timestamp(value: unknown) {
  return value instanceof Date ? value.toISOString() : String(value)
}

function dateValue(value: unknown) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value)
}

function toFact(row: FactRow) {
  return businessBrainFactSchema.parse({
    id: row.id,
    brandId: row.brand_id,
    kind: row.kind,
    status: row.status,
    text: row.text,
    source: row.source,
    sourceUrl: row.source_url,
    sourceType: row.source_type,
    confidence: Number(row.confidence),
    version: row.version,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    verifiedAt: row.verified_at ? timestamp(row.verified_at) : null,
    verifiedBy: row.verified_by,
    rejectedAt: row.rejected_at ? timestamp(row.rejected_at) : null,
    rejectedBy: row.rejected_by,
  })
}

function toVoice(row: VoiceRow) {
  return voiceVersionSchema.parse({
    id: row.id,
    brandId: row.brand_id,
    version: row.version,
    text: row.text,
    source: row.source,
    active: row.active,
    createdAt: timestamp(row.created_at),
  })
}

function toAudience(row: AudienceRow) {
  return audienceSchema.parse({
    id: row.id,
    brandId: row.brand_id,
    name: row.name,
    description: row.description,
    status: row.status,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  })
}

function toOffer(row: OfferRow) {
  return offerSchema.parse({
    id: row.id,
    brandId: row.brand_id,
    name: row.name,
    description: row.description,
    currency: row.currency,
    amount: row.amount === null ? null : Number(row.amount),
    validFrom: dateValue(row.valid_from),
    validUntil: row.valid_until ? dateValue(row.valid_until) : null,
    source: row.source,
    confidence: Number(row.confidence),
    status: row.status,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  })
}

function toGuardrail(row: GuardrailRow) {
  return guardrailSchema.parse({
    id: row.id,
    brandId: row.brand_id,
    text: row.text,
    source: row.source,
    status: row.status,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  })
}

const factColumns =
  'id, brand_id, kind, status, text, source, source_url, source_type, confidence, version, verified_at, verified_by, rejected_at, rejected_by, created_at, updated_at'
const voiceColumns = 'id, brand_id, version, text, source, active, created_at'
const audienceColumns = 'id, brand_id, name, description, status, created_at, updated_at'
const offerColumns =
  'id, brand_id, name, description, currency, amount, valid_from, valid_until, source, confidence, status, created_at, updated_at'
const guardrailColumns = 'id, brand_id, text, source, status, created_at, updated_at'

export async function getBusinessBrain(
  client: PoolClient,
  organizationId: string,
  brandId: string,
) {
  // A PoolClient can execute only one query at a time. Keep these reads
  // sequential to avoid pg's concurrent-query deprecation warning.
  const brand = await client.query<{ revision: number }>(
    'SELECT revision FROM brands WHERE id=$1 AND organization_id=$2',
    [brandId, organizationId],
  )
  const facts = await client.query<FactRow>(
    `SELECT ${factColumns} FROM brand_facts WHERE brand_id=$1 AND organization_id=$2 AND status <> 'archived' ORDER BY created_at DESC`,
    [brandId, organizationId],
  )
  const voiceVersions = await client.query<VoiceRow>(
    `SELECT ${voiceColumns} FROM brand_voice_versions WHERE brand_id=$1 AND organization_id=$2 ORDER BY version DESC`,
    [brandId, organizationId],
  )
  const audiences = await client.query<AudienceRow>(
    `SELECT ${audienceColumns} FROM brand_audiences WHERE brand_id=$1 AND organization_id=$2 AND status <> 'archived' ORDER BY created_at`,
    [brandId, organizationId],
  )
  const offers = await client.query<OfferRow>(
    `SELECT ${offerColumns} FROM brand_offers WHERE brand_id=$1 AND organization_id=$2 AND status <> 'archived' ORDER BY valid_from DESC, created_at DESC`,
    [brandId, organizationId],
  )
  const guardrails = await client.query<GuardrailRow>(
    `SELECT ${guardrailColumns} FROM brand_guardrails WHERE brand_id=$1 AND organization_id=$2 AND status <> 'archived' ORDER BY created_at`,
    [brandId, organizationId],
  )
  if (!brand.rows[0]) throw createError({ statusCode: 404, message: 'Brandi nuk u gjet.' })
  return businessBrainSchema.parse({
    revision: brand.rows[0].revision,
    facts: facts.rows.map(toFact),
    voiceVersions: voiceVersions.rows.map(toVoice),
    audiences: audiences.rows.map(toAudience),
    offers: offers.rows.map(toOffer),
    guardrails: guardrails.rows.map(toGuardrail),
  })
}

async function lockBrand(client: PoolClient, organizationId: string, brandId: string) {
  const result = await client.query<{ revision: number; status: string }>(
    'SELECT revision, status FROM brands WHERE id=$1 AND organization_id=$2 FOR UPDATE',
    [brandId, organizationId],
  )
  if (!result.rows[0]) throw createError({ statusCode: 404, message: 'Brandi nuk u gjet.' })
  if (result.rows[0].status === 'archived')
    throw createError({ statusCode: 409, message: 'Brandi i arkivuar nuk mund te ndryshohet.' })
  return result.rows[0]
}

async function bumpBrand(client: PoolClient, organizationId: string, brandId: string) {
  await client.query(
    'UPDATE brands SET revision=revision+1, updated_at=now() WHERE id=$1 AND organization_id=$2',
    [brandId, organizationId],
  )
}

async function syncLegacyFacts(client: PoolClient, organizationId: string, brandId: string) {
  await client.query(
    `UPDATE brands SET profile=jsonb_set(COALESCE(profile, '{}'::jsonb), '{facts}', COALESCE((
       SELECT jsonb_agg(jsonb_build_object('id', id, 'text', text, 'source', source, 'verified', status='verified') ORDER BY created_at)
       FROM brand_facts WHERE brand_id=$1 AND organization_id=$2 AND status <> 'archived'
    ), '[]'::jsonb), true), updated_at=now() WHERE id=$1 AND organization_id=$2`,
    [brandId, organizationId],
  )
}

export async function createBusinessBrainFact(
  client: PoolClient,
  organizationId: string,
  brandId: string,
  input: CreateFact,
) {
  await lockBrand(client, organizationId, brandId)
  const result = await client.query<FactRow>(
    `INSERT INTO brand_facts (organization_id, brand_id, kind, text, source, source_url, source_type, confidence)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${factColumns}`,
    [
      organizationId,
      brandId,
      input.kind,
      input.text,
      input.source,
      input.sourceUrl,
      input.sourceType,
      input.confidence,
    ],
  )
  await syncLegacyFacts(client, organizationId, brandId)
  await bumpBrand(client, organizationId, brandId)
  return toFact(result.rows[0]!)
}

export async function updateExplicitFact(
  client: PoolClient,
  organizationId: string,
  brandId: string,
  factId: string,
  input: UpdateFact,
) {
  await lockBrand(client, organizationId, brandId)
  const result = await client.query<FactRow>(
    `UPDATE brand_facts SET text=$1, source=$2, source_url=$3, confidence=$4, version=version+1, updated_at=now()
     WHERE id=$5 AND brand_id=$6 AND organization_id=$7 AND kind='explicit' AND status <> 'archived'
     RETURNING ${factColumns}`,
    [input.text, input.source, input.sourceUrl, input.confidence, factId, brandId, organizationId],
  )
  if (!result.rows[0])
    throw createError({ statusCode: 404, message: 'Fakti eksplicit nuk u gjet.' })
  await syncLegacyFacts(client, organizationId, brandId)
  await bumpBrand(client, organizationId, brandId)
  return toFact(result.rows[0])
}

export async function transitionBusinessBrainFact(
  client: PoolClient,
  organizationId: string,
  brandId: string,
  factId: string,
  status: 'verified' | 'rejected',
  userId: string,
) {
  await lockBrand(client, organizationId, brandId)
  const result = await client.query<FactRow>(
    `UPDATE brand_facts
     SET status=$1, verified_at=CASE WHEN $1='verified' THEN now() ELSE NULL END,
         verified_by=CASE WHEN $1='verified' THEN $2::uuid ELSE NULL::uuid END,
         rejected_at=CASE WHEN $1='rejected' THEN now() ELSE NULL END,
         rejected_by=CASE WHEN $1='rejected' THEN $2::uuid ELSE NULL::uuid END,
         version=version+1, updated_at=now()
     WHERE id=$3 AND brand_id=$4 AND organization_id=$5 AND status='proposed'
     RETURNING ${factColumns}`,
    [status, userId, factId, brandId, organizationId],
  )
  if (!result.rows[0])
    throw createError({ statusCode: 409, message: 'Fakti nuk mund te kaloje ne kete status.' })
  await syncLegacyFacts(client, organizationId, brandId)
  await bumpBrand(client, organizationId, brandId)
  return toFact(result.rows[0])
}

export async function createBusinessBrainOffer(
  client: PoolClient,
  organizationId: string,
  brandId: string,
  input: CreateOffer,
) {
  await lockBrand(client, organizationId, brandId)
  const result = await client.query<OfferRow>(
    `INSERT INTO brand_offers (organization_id, brand_id, name, description, currency, amount, valid_from, valid_until, source, confidence)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${offerColumns}`,
    [
      organizationId,
      brandId,
      input.name,
      input.description,
      input.currency,
      input.amount,
      input.validFrom,
      input.validUntil,
      input.source,
      input.confidence,
    ],
  )
  await bumpBrand(client, organizationId, brandId)
  return toOffer(result.rows[0]!)
}

export async function activateBusinessBrainOffer(
  client: PoolClient,
  organizationId: string,
  brandId: string,
  offerId: string,
) {
  await lockBrand(client, organizationId, brandId)
  const result = await client.query<OfferRow>(
    `UPDATE brand_offers SET status='active', updated_at=now()
     WHERE id=$1 AND brand_id=$2 AND organization_id=$3 AND status='draft'
       AND valid_from <= CURRENT_DATE AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
     RETURNING ${offerColumns}`,
    [offerId, brandId, organizationId],
  )
  if (!result.rows[0])
    throw createError({ statusCode: 422, message: 'Oferta nuk eshte valide per aktivizim.' })
  await bumpBrand(client, organizationId, brandId)
  return toOffer(result.rows[0])
}

export async function updateBusinessBrainSettings(
  client: PoolClient,
  organizationId: string,
  brandId: string,
  input: {
    revision: number
    voice: { text: string; source: string }
    audiences: Array<{ id?: string; name: string; description: string }>
    guardrails: Array<{ id?: string; text: string; source: string }>
  },
) {
  const current = await lockBrand(client, organizationId, brandId)
  if (current.revision !== input.revision)
    throw createError({
      statusCode: 409,
      message: 'Business Brain ndryshoi ne nje pajisje tjeter.',
    })
  await client.query(
    'UPDATE brand_voice_versions SET active=false WHERE brand_id=$1 AND organization_id=$2 AND active=true',
    [brandId, organizationId],
  )
  const currentVoice = await client.query<{ version: number }>(
    'SELECT COALESCE(MAX(version),0) AS version FROM brand_voice_versions WHERE brand_id=$1 AND organization_id=$2',
    [brandId, organizationId],
  )
  await client.query(
    'INSERT INTO brand_voice_versions (organization_id,brand_id,version,text,source,active) VALUES ($1,$2,$3,$4,$5,true)',
    [
      organizationId,
      brandId,
      Number(currentVoice.rows[0]!.version) + 1,
      input.voice.text,
      input.voice.source,
    ],
  )

  for (const audience of input.audiences) {
    if (audience.id) {
      const updated = await client.query(
        "UPDATE brand_audiences SET name=$1,description=$2,status='active',updated_at=now() WHERE id=$3 AND brand_id=$4 AND organization_id=$5",
        [audience.name, audience.description, audience.id, brandId, organizationId],
      )
      if (updated.rowCount) continue
    }
    await client.query(
      'INSERT INTO brand_audiences (organization_id,brand_id,name,description) VALUES ($1,$2,$3,$4)',
      [organizationId, brandId, audience.name, audience.description],
    )
  }
  for (const guardrail of input.guardrails) {
    if (guardrail.id) {
      const updated = await client.query(
        "UPDATE brand_guardrails SET text=$1,source=$2,status='active',updated_at=now() WHERE id=$3 AND brand_id=$4 AND organization_id=$5",
        [guardrail.text, guardrail.source, guardrail.id, brandId, organizationId],
      )
      if (updated.rowCount) continue
    }
    await client.query(
      'INSERT INTO brand_guardrails (organization_id,brand_id,text,source) VALUES ($1,$2,$3,$4)',
      [organizationId, brandId, guardrail.text, guardrail.source],
    )
  }
  const audienceText = input.audiences
    .map((item) => item.name)
    .filter(Boolean)
    .join(', ')
  await client.query(
    `UPDATE brands SET profile=jsonb_set(jsonb_set(COALESCE(profile, '{}'::jsonb), '{voice}', to_jsonb($1::text), true), '{audience}', to_jsonb($2::text), true), updated_at=now()
     WHERE id=$3 AND organization_id=$4`,
    [input.voice.text, audienceText, brandId, organizationId],
  )
  await bumpBrand(client, organizationId, brandId)
  return getBusinessBrain(client, organizationId, brandId)
}

export class BrainFailure extends Error {}
export function normalizeBrandFact(
  input: BrandFact,
  previous: BrandFact | undefined,
  actorId: string,
  now = new Date(),
): BrandFact {
  const next = brandFactSchema.parse(input)
  const changed = !!previous && !sameFactContent(next, previous)
  // Editing an already verified claim invalidates its previous confirmation.
  // A subsequent explicit confirmation may verify the revised claim.
  const verified = next.verified && !(changed && previous?.verified)
  const problem = factInputProblem({ ...next, verified })
  if (problem) throw new BrainFailure(problem)
  const confirming = verified && !previous?.verified
  const state = verified ? 'verified' : next.state === 'rejected' ? 'rejected' : 'proposed'
  return {
    ...next,
    kind: next.kind || 'fact',
    validFrom: next.validFrom || null,
    validUntil: next.validUntil || null,
    amountCents: next.amountCents ?? null,
    currency: next.amountCents != null ? 'EUR' : null,
    verified,
    state,
    origin: previous?.origin || 'user',
    confidence: previous?.confidence ?? null,
    verifiedBy: verified ? (confirming ? actorId : previous?.verifiedBy || null) : null,
    verifiedAt: verified ? (confirming ? now.toISOString() : previous?.verifiedAt || null) : null,
    revision: previous
      ? (previous.revision || 1) +
        (changed ||
        verified !== previous.verified ||
        state !== (previous.state || (previous.verified ? 'verified' : 'proposed'))
          ? 1
          : 0)
      : 1,
  }
}
export async function syncBusinessBrain(
  client: PoolClient,
  businessId: string,
  actorId: string,
  input: Workspace['brand'],
  current: Workspace['brand'],
) {
  const seen = new Set<string>()
  const facts = input.facts.map((fact) => {
    if (seen.has(fact.id)) throw new BrainFailure('Çdo fakt duhet të ketë identifikues të veçantë.')
    seen.add(fact.id)
    return normalizeBrandFact(
      fact,
      current.facts.find((previous) => previous.id === fact.id),
      actorId,
    )
  })
  const next: Workspace['brand'] = {
    ...input,
    facts,
    guardrails: input.guardrails || [],
    brainVersion: current.brainVersion || 1,
  }
  const comparison = (brand: Workspace['brand']) => ({
    ...brand,
    facts: brand.facts.map((fact) => normalizeBrandFact(fact, fact, actorId)),
    brainVersion: undefined,
    guardrails: brand.guardrails || [],
  })
  const changed = evidenceHash(comparison(next)) !== evidenceHash(comparison(current))
  if (changed) next.brainVersion = (current.brainVersion || 1) + 1
  // Immutable snapshots capture both facts and voice/guardrail changes.
  await client.query(
    'INSERT INTO business_brain_versions(business_id,version,snapshot,actor_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
    [businessId, current.brainVersion || 1, JSON.stringify(current), actorId],
  )
  for (const fact of facts) {
    const saved = await client.query(
      `INSERT INTO business_facts(business_id,id,text,source,kind,status,valid_from,valid_until,amount_cents,currency,origin,confidence,verified_by,verified_at,revision)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT(business_id,id) DO UPDATE SET text=EXCLUDED.text,source=EXCLUDED.source,kind=EXCLUDED.kind,status=EXCLUDED.status,valid_from=EXCLUDED.valid_from,valid_until=EXCLUDED.valid_until,amount_cents=EXCLUDED.amount_cents,currency=EXCLUDED.currency,verified_by=EXCLUDED.verified_by,verified_at=EXCLUDED.verified_at,revision=EXCLUDED.revision,updated_at=now()
      WHERE business_facts.status<>'archived' RETURNING id`,
      [
        businessId,
        fact.id,
        fact.text,
        fact.source,
        fact.kind,
        fact.state,
        fact.validFrom,
        fact.validUntil,
        fact.amountCents,
        fact.currency,
        fact.origin,
        fact.confidence,
        fact.verifiedBy,
        fact.verifiedAt,
        fact.revision,
      ],
    )
    if (!saved.rowCount)
      throw new BrainFailure('Ky identifikues i përket një fakti të arkivuar. Shto një fakt të ri.')
  }
  await client.query(
    "UPDATE business_facts SET status='archived',verified_by=NULL,verified_at=NULL,revision=revision+1,updated_at=now() WHERE business_id=$1 AND status<>'archived' AND NOT(id=ANY($2::text[]))",
    [businessId, facts.map((fact) => fact.id)],
  )
  if (changed)
    await client.query(
      'INSERT INTO business_brain_versions(business_id,version,snapshot,actor_id) VALUES($1,$2,$3,$4) ON CONFLICT(business_id,version) DO NOTHING',
      [businessId, next.brainVersion, JSON.stringify(next), actorId],
    )
  return next
}
