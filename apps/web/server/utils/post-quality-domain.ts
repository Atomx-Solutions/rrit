import type { z } from 'zod'
import type { Post, Workspace } from '../../shared/schemas/workspace'
import { factContent } from '../../shared/schemas/business-brain'
import { qualitySchema } from '../../shared/schemas/monthly-plan'
import { evidenceHash } from './monthly-planner-domain'
import { responseText, type ProviderResponse } from './monthly-ai'
import { dayInZone } from '../../shared/utils/calendar'

export function qualityBrandHash(brand: Workspace['brand']) {
  return evidenceHash({
    name: brand.name,
    industry: brand.industry,
    city: brand.city,
    description: brand.description,
    voice: brand.voice,
    audience: brand.audience,
    color: brand.color,
    guardrails: brand.guardrails || [],
    facts: brand.facts
      .filter((fact) => fact.verified)
      .map((fact) => ({
        id: fact.id,
        ...factContent(fact),
        verified: fact.verified,
        state: fact.state || 'verified',
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  })
}
export function qualityReviewKey(
  post: Post,
  fingerprint: string,
  brand: Workspace['brand'],
  day: string,
) {
  return `review:${post.id}:${post.contentVersion || 1}:${fingerprint}:${qualityBrandHash(brand)}:${day}`
}
export function qualityReviewDay(post: Post, timezone: string, now = new Date()) {
  const intended = dayInZone(post.scheduledAt || post.proposedAt || now, timezone)
  const today = dayInZone(now, timezone)
  return intended > today ? intended : today
}
export function reviewedQuality(raw: ProviderResponse) {
  return normalizeQualityReview(qualitySchema.parse(JSON.parse(responseText(raw))))
}

export function normalizeQualityReview(quality: z.infer<typeof qualitySchema>) {
  // Factual safety is always terminal. Brand-fit and visual-quality findings
  // can be subjective refinements, so respect an explicit WARN from the
  // reviewer and surface its reasons to the human approver.
  if (!quality.factuality) quality.decision = 'BLOCK'
  else if (quality.decision === 'PASS' && (!quality.brandFit || !quality.visualQuality))
    quality.decision = 'WARN'
  return quality
}
