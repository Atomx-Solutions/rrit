import { z } from 'zod'

export const evaluationDimensions = [
  'factuality',
  'research',
  'brandFit',
  'readability',
  'diversity',
  'safety',
  'cost',
  'latency',
] as const
const ratingsSchema = z.object(
  Object.fromEntries(evaluationDimensions.map((dimension) => [dimension, z.number().int().min(0).max(2)])),
) as z.ZodType<Record<(typeof evaluationDimensions)[number], number>>
export const evaluationCaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{3,80}$/),
  title: z.string().min(3).max(200),
  // A research case must have an actual, opened source in the evidence bundle.
  requiresSourceEvidence: z.boolean(),
})
export const evaluationResultSchema = z.object({
  caseId: evaluationCaseSchema.shape.id,
  model: z.string().min(1).max(200),
  promptVersion: z.string().min(1).max(200),
  executedAt: z.iso.datetime(),
  evidenceUrls: z.array(z.url()).max(20),
  ratings: ratingsSchema,
  hardFailures: z.array(z.string().min(3).max(500)).max(20),
})
export type EvaluationCase = z.infer<typeof evaluationCaseSchema>
export type EvaluationResult = z.infer<typeof evaluationResultSchema>

export function assessMonthlyEvaluation(cases: EvaluationCase[], results: EvaluationResult[]) {
  const required = new Map(cases.map((item) => [item.id, item]))
  const seen = new Set<string>()
  const failures: string[] = []
  const totals = Object.fromEntries(evaluationDimensions.map((item) => [item, 0])) as Record<
    (typeof evaluationDimensions)[number],
    number
  >
  for (const result of results) {
    const scenario = required.get(result.caseId)
    if (!scenario) {
      failures.push(`Rast i panjohur: ${result.caseId}`)
      continue
    }
    if (seen.has(result.caseId)) {
      failures.push(`Rasti u vlerësua më shumë se një herë: ${result.caseId}`)
      continue
    }
    seen.add(result.caseId)
    if (scenario.requiresSourceEvidence && !result.evidenceUrls.length)
      failures.push(`Mungon burimi i hapshëm për rastin: ${result.caseId}`)
    if (result.hardFailures.length)
      failures.push(`Dështim kritik te ${result.caseId}: ${result.hardFailures.join('; ')}`)
    for (const dimension of evaluationDimensions) {
      totals[dimension] += result.ratings[dimension]
      if (['factuality', 'research', 'safety'].includes(dimension) && result.ratings[dimension] < 2)
        failures.push(`Kontrolli kritik ${dimension} nuk kaloi te ${result.caseId}`)
    }
  }
  for (const scenario of cases)
    if (!seen.has(scenario.id)) failures.push(`Mungon rasti i kërkuar: ${scenario.id}`)
  const average = Object.fromEntries(
    evaluationDimensions.map((dimension) => [
      dimension,
      results.length ? totals[dimension] / results.length : 0,
    ]),
  ) as Record<(typeof evaluationDimensions)[number], number>
  for (const dimension of ['brandFit', 'readability', 'diversity', 'cost', 'latency'] as const)
    if (average[dimension] < 1.5)
      failures.push(`Mesatarja e ${dimension} është nën pragun 1.5/2`)
  const models = new Set(results.map((result) => result.model))
  const prompts = new Set(results.map((result) => result.promptVersion))
  if (models.size > 1) failures.push('Rezultatet i përkasin më shumë se një modeli.')
  if (prompts.size > 1) failures.push('Rezultatet i përkasin më shumë se një versioni prompti.')
  return { passed: failures.length === 0, failures, average, caseCount: seen.size }
}
