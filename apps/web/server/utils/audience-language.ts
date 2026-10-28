import { researchSchema } from '../../shared/schemas/monthly-plan'
import type { AppLocaleValue } from '../../shared/schemas/workspace'

// A post written for an occasion's visitors records its own language, and every
// later review and render of that post must keep speaking it. Posts without one
// speak the plan's research decision. The fallback keeps a post/plan created
// before this feature readable and reviewable.
export function audienceLanguageFromResearch(
  research: unknown,
  fallback: AppLocaleValue,
  postLocale?: AppLocaleValue,
): AppLocaleValue {
  if (postLocale) return postLocale
  const parsed = researchSchema.safeParse(research)
  return parsed.success && parsed.data.language ? parsed.data.language.locale : fallback
}
