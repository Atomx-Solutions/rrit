import { openRouterAccount } from '../../../utils/openrouter-account'
import { platformSettings } from '../../../utils/admin-settings'

// Just the provider balance and the warning threshold, so the overview can show
// a low-balance notice without loading the whole AI cost report.
export default defineEventHandler(async (event) => {
  const [account, settings] = await Promise.all([openRouterAccount(), platformSettings()])
  const balanceUsd = account?.account?.balance_usd ?? null
  setHeader(event, 'Cache-Control', 'private, no-store')
  return {
    balance_usd: balanceUsd,
    usd_micro_eur: account?.usd_micro_eur ?? null,
    low_balance_usd: settings.ai_low_balance_usd,
    warn_balance_usd: settings.ai_warn_balance_usd,
    // "critical" means the AI is about to stop; "warning" means it is getting close.
    level: balanceUsd === null
      ? 'ok'
      : balanceUsd < settings.ai_low_balance_usd
        ? 'critical'
        : balanceUsd < settings.ai_warn_balance_usd ? 'warning' : 'ok',
    top_up_url: settings.ai_top_up_url,
    error: account?.error ?? null,
  }
})
