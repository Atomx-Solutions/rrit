// Reconcile stored AI calls with OpenRouter's authoritative generation API.
//
// OpenRouter's /generation endpoint is the source of truth for the charge and
// normalized token counts of a request. The normal API key can read the
// generations made with that key; a 404 means the generation belongs to a
// different key/environment (or is no longer available).
//
// Usage:
//   node --env-file=../../.env scripts/backfill-provider-costs.mjs
//   node --env-file=../../.env scripts/backfill-provider-costs.mjs --dry-run
//   node --env-file=../../.env scripts/backfill-provider-costs.mjs --missing-only
//   node --env-file=../../.env scripts/backfill-provider-costs.mjs --current-only
import { createHash } from 'node:crypto'
import pg from 'pg'

const dryRun = process.argv.includes('--dry-run')
const missingOnly = process.argv.includes('--missing-only')
const currentOnly = process.argv.includes('--current-only')
const apiKey = process.env.OPENROUTER_API_KEY?.trim()
const usdMicroEur = Number(process.env.AI_USD_MICRO_EUR)
const connectionString = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL
if (process.env.AI_PROVIDER !== 'openrouter' || !apiKey)
  throw new Error('OpenRouter is not the configured provider.')
if (!Number.isSafeInteger(usdMicroEur) || usdMicroEur <= 0)
  throw new Error('AI_USD_MICRO_EUR is not configured.')
if (!connectionString) throw new Error('DATABASE_URL is not configured.')

const fingerprint = createHash('sha256').update(apiKey).digest('hex').slice(0, 16)
const client = new pg.Client({ connectionString })
await client.connect()

const filter = [
  missingOnly ? `AND provider_cost_usd IS NULL` : '',
  currentOnly ? `AND (provider_key_fingerprint=$1 OR provider_key_fingerprint IS NULL)` : '',
]
  .filter(Boolean)
  .join(' ')
const { rows } = await client.query(`
  SELECT 'monthly_ai_runs' AS table_name, id, provider_response_id
  FROM monthly_ai_runs
  WHERE status='completed' AND provider_response_id LIKE 'gen-%' ${filter}
  UNION ALL
  SELECT 'ai_cost_ledger' AS table_name, id, provider_response_id
  FROM ai_cost_ledger
  WHERE status='committed' AND provider_response_id LIKE 'gen-%' ${filter}
  ORDER BY provider_response_id
`, currentOnly ? [fingerprint] : [])
console.log(`${rows.length} generations to reconcile${dryRun ? ' (dry run)' : ''}.`)

const counts = { platform: 0, other: 0, failed: 0 }

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

async function updateGeneration(row, data) {
  const totalCostUsd = finiteNumber(data?.total_cost)
  const inputTokens = nonNegativeInteger(data?.tokens_prompt)
  const outputTokens = nonNegativeInteger(data?.tokens_completion)
  if (totalCostUsd === null || totalCostUsd < 0 || inputTokens === null || outputTokens === null) {
    counts.failed++
    console.warn(`Generation ${row.provider_response_id}: response is missing cost or token metadata.`)
    return
  }

  const actualCostMicroEur = Math.ceil(totalCostUsd * usdMicroEur)
  const model = typeof data.model === 'string' && data.model ? data.model : null
  const providerName = typeof data.provider_name === 'string' && data.provider_name ? data.provider_name : null
  counts.platform++
  if (dryRun) return

  if (row.table_name === 'monthly_ai_runs') {
    await client.query(
      `UPDATE monthly_ai_runs
       SET provider_key_fingerprint=$2, provider_cost_usd=$3,
           actual_cost_micro_eur=$4, provider_model=COALESCE($5, provider_model),
           provider_name=COALESCE($6, provider_name), provider_input_tokens=$7,
           provider_output_tokens=$8
       WHERE id=$1`,
      [row.id, fingerprint, totalCostUsd, actualCostMicroEur, model, providerName, inputTokens, outputTokens],
    )
  } else {
    await client.query(
      `UPDATE ai_cost_ledger
       SET provider_key_fingerprint=$2, provider_cost_usd=$3,
           actual_cost_micro_eur=$4, provider_model=COALESCE($5, provider_model),
           provider_name=COALESCE($6, provider_name), provider_input_tokens=$7,
           provider_output_tokens=$8
       WHERE id=$1 AND status='committed'`,
      [row.id, fingerprint, totalCostUsd, actualCostMicroEur, model, providerName, inputTokens, outputTokens],
    )
  }
}

for (const row of rows) {
  const params = new URLSearchParams({ id: row.provider_response_id })
  let response
  try {
    response = await fetch(`https://openrouter.ai/api/v1/generation?${params}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    })
  } catch (error) {
    counts.failed++
    console.warn(`Generation ${row.provider_response_id}: request failed (${error instanceof Error ? error.message : 'unknown error'}).`)
    continue
  }

  const payload = await response.json().catch(() => null)
  if (response.status === 200) {
    await updateGeneration(row, payload?.data)
  } else if (response.status === 404) {
    counts.other++
    if (!dryRun) {
      await client.query(
        `UPDATE ${row.table_name} SET provider_key_fingerprint='other' WHERE id=$1`,
        [row.id],
      )
    }
  } else {
    counts.failed++
    console.warn(`Generation ${row.provider_response_id}: OpenRouter answered ${response.status}; left unchanged.`)
  }
  await new Promise((resolve) => setTimeout(resolve, 150))
}

await client.end()
console.log(`Current key: ${counts.platform}, other environments: ${counts.other}, not checked: ${counts.failed}.`)
