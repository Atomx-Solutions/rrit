import { researchSchema } from '../../shared/schemas/monthly-plan'
import type { AppLocaleValue } from '../../shared/schemas/workspace'

// New plans always persist this decision with research. The fallback keeps a
// post/plan created before this feature readable and reviewable.
export function audienceLanguageFromResearch(
  research: unknown,
  fallback: AppLocaleValue,
): AppLocaleValue {
  const parsed = researchSchema.safeParse(research)
  return parsed.success && parsed.data.language ? parsed.data.language.locale : fallback
}
