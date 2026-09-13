import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import {
  assessMonthlyEvaluation,
  evaluationCaseSchema,
  evaluationResultSchema,
} from '../server/utils/monthly-evaluation.ts'

const [casesPath, resultsPath] = process.argv.slice(2)
if (!casesPath || !resultsPath) {
  console.error('Usage: npm run ai:evaluate -- <cases.json> <real-provider-results.json>')
  process.exitCode = 2
} else {
  const [rawCases, rawResults] = await Promise.all([
    readFile(casesPath, 'utf8'),
    readFile(resultsPath, 'utf8'),
  ])
  const cases = z.array(evaluationCaseSchema).min(1).parse(JSON.parse(rawCases))
  const results = z.array(evaluationResultSchema).min(1).parse(JSON.parse(rawResults))
  const report = assessMonthlyEvaluation(cases, results)
  console.log(JSON.stringify(report, null, 2))
  if (!report.passed) process.exitCode = 1
}
