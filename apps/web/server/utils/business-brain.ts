import type { PoolClient } from 'pg'
import type { Workspace } from '../../shared/schemas/workspace'
import {
  brandFactSchema,
  factInputProblem,
  offersFromFacts,
  plannerBrainSchema,
  sameFactContent,
  type BrandFact,
  type PlannerBrain,
} from '../../shared/schemas/business-brain'
import { evidenceHash } from './monthly-planner-domain'

// pg reads a date column as local midnight, so the calendar day is taken from
// the local fields. Converting it to UTC first would move it to the day
// before wherever the server runs ahead of UTC, and two processes in
// different zones would then disagree about the same offer.
export function dateValue(value: unknown) {
  if (!(value instanceof Date)) return String(value)
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}

export async function loadPlannerBrain(
  _client: PoolClient,
  _organizationId: string,
  _brandId: string,
  workspaceFacts: BrandFact[],
): Promise<{ brain: PlannerBrain; facts: BrandFact[] }> {
  const brain = plannerBrainSchema.parse({
    voice: '',
    audiences: [],
    offers: offersFromFacts(workspaceFacts).slice(0, 20),
    guardrails: [],
  })
  return { brain, facts: [] }
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
  // A product is sold for as long as the business lists it, so it keeps no
  // window of its own; only an offer or a dated fact does.
  const dated = next.kind !== 'product'
  return {
    ...next,
    kind: next.kind || 'fact',
    validFrom: dated ? next.validFrom || null : null,
    validUntil: dated ? next.validUntil || null : null,
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
    if (seen.has(fact.id)) throw new BrainFailure('server.FACT_DUPLICATE_ID')
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
      throw new BrainFailure('server.FACT_ID_ARCHIVED')
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
