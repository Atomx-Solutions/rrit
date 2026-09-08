function positiveInteger(name: string) {
  const value = Number(process.env[name])
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} is not configured`)
  return value
}

export function aiCostConfiguration() {
  return {
    inputMicroEurPerMillion: positiveInteger('AI_INPUT_MICRO_EUR_PER_MILLION_TOKENS'),
    outputMicroEurPerMillion: positiveInteger('AI_OUTPUT_MICRO_EUR_PER_MILLION_TOKENS'),
    dailyBudgetMicroEur: positiveInteger('AI_DAILY_BUDGET_MICRO_EUR'),
  }
}

export function aiCostConfigured() {
  try {
    aiCostConfiguration()
    return true
  } catch {
    return false
  }
}

export function calculateAiCost(inputTokens: number, outputTokens: number) {
  const config = aiCostConfiguration()
  return Math.ceil(
    (inputTokens * config.inputMicroEurPerMillion +
      outputTokens * config.outputMicroEurPerMillion) /
      1_000_000,
  )
}
