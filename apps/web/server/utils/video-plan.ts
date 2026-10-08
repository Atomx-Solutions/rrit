import type { Post } from '../../shared/schemas/workspace'
import type { ShotDirection } from '../../shared/schemas/monthly-plan'

export type VideoCreativePlanBeat = {
  role: 'hook' | 'body' | 'cta' | 'endcard'
  weight: number
  motion: string
}

export type VideoCreativePlan = {
  concept: string
  shot: ShotDirection
  timeline: VideoCreativePlanBeat[]
  typography: {
    language: 'sq-XK' | 'en-US' | 'de-DE'
    hook: string
    cta: string
  }
  branding: {
    primaryColor?: string
    logoAssetId: string | null
  }
}

// A video brief that was persisted before shot direction existed falls back on
// a composition that reads well on a 9:16 phone with a centred subject and the
// text zone along the bottom. The defaults are chosen so a legacy brief never
// produces a broken plan, not to be aesthetically opinionated.
const DEFAULT_SHOT: ShotDirection = {
  camera: 'slow_push',
  pacing: 'measured',
  subjectAnchor: 'centre',
  textZone: 'bottom',
  action: 'camera_only',
  endCard: true,
}

// Timeline weights are proportions of the clip, not seconds, so the same plan
// drives a 6s or a 12s video without recomputation. The role order is fixed:
// hook opens, body carries the subject motion, cta closes. An end-card beat is
// reserved for later deterministic composition but is not emitted today so the
// current provider does not try to render a static final second itself.
function timelineFor(durationSeconds: number): VideoCreativePlanBeat[] {
  // Short clips (≤6s) collapse to two beats so each one is long enough to read.
  if (durationSeconds <= 6) {
    return [
      { role: 'hook', weight: 0.35, motion: 'Open on the subject; the hook arrives inside the opening third.' },
      { role: 'cta', weight: 0.65, motion: 'Resolve on the subject; the call to action arrives inside the closing third.' },
    ]
  }
  // Default three-beat shape for mid-length clips (~7-12s).
  if (durationSeconds <= 12) {
    return [
      { role: 'hook', weight: 0.25, motion: 'Open on the subject; the hook arrives inside the opening quarter.' },
      { role: 'body', weight: 0.5, motion: 'Carry the strategy motion idea through the middle without changing camera idea.' },
      { role: 'cta', weight: 0.25, motion: 'Resolve on the subject; the call to action arrives inside the closing quarter.' },
    ]
  }
  // Long clips add a dedicated end-card beat; still one single camera idea.
  return [
    { role: 'hook', weight: 0.2, motion: 'Open on the subject; the hook arrives inside the opening fifth.' },
    { role: 'body', weight: 0.45, motion: 'Carry the strategy motion idea through the middle without changing camera idea.' },
    { role: 'cta', weight: 0.2, motion: 'Resolve on the subject; the call to action arrives inside the closing fifth.' },
    { role: 'endcard', weight: 0.15, motion: 'Hold the brand mark zone clean for the end-card the application will add later.' },
  ]
}

// A short concept line the prompt uses as the top-level description of what
// this video is. Derived deterministically from the strategy's purpose and
// visual layout; falls back to the hook when neither is present.
function conceptFrom(brief: {
  purpose?: string
  visualLayout?: string
  hook: string
}): string {
  const purpose = brief.purpose?.trim() || ''
  const layout = brief.visualLayout?.trim() || ''
  if (purpose && layout) return `${purpose} — ${layout}`.slice(0, 240)
  return (purpose || layout || brief.hook).slice(0, 240)
}

/**
 * Deterministic Video Creative Plan builder.
 *
 * No AI call. Reads the already-persisted brief, the workspace brand and the
 * target duration, and returns a structured plan the provider adapter and the
 * future deterministic composition stage both consume. The plan is rebuilt per
 * render rather than persisted, because every input it depends on already
 * lives on the post or the workspace.
 */
export function buildVideoCreativePlan(input: {
  brief: NonNullable<Post['video']>
  brand: { color?: string }
  locale?: 'sq-XK' | 'en-US' | 'de-DE'
  durationSeconds: number
}): VideoCreativePlan {
  const { brief, brand, locale, durationSeconds } = input
  const shot = brief.shot || DEFAULT_SHOT
  const beats = timelineFor(durationSeconds)
  // The sum is 1 by construction above, but assert it to catch any future
  // table edit that violates the invariant the provider adapter relies on.
  const totalWeight = beats.reduce((sum, beat) => sum + beat.weight, 0)
  if (Math.abs(totalWeight - 1) > 0.001)
    throw new Error(`Video timeline weights must sum to 1 (got ${totalWeight})`)
  return {
    concept: conceptFrom({
      purpose: brief.purpose,
      visualLayout: brief.visualLayout,
      hook: brief.hook,
    }),
    shot,
    timeline: beats,
    typography: {
      language: locale || 'sq-XK',
      hook: brief.hook,
      cta: brief.cta,
    },
    branding: {
      primaryColor: brand.color,
      logoAssetId: brief.logoAssetId || null,
    },
  }
}
