-- PRC-08: research and generation wallets are merged back into one balance.
-- Every AI action (research, planning, generation, captions) spends from the
-- same remaining_credits/reserved_credits pair. Existing wallet credits are
-- summed so no customer loses a purchased credit.
UPDATE credit_balances
SET remaining_credits = remaining_credits + research_remaining_credits + generation_remaining_credits,
    reserved_credits = reserved_credits + research_reserved_credits + generation_reserved_credits,
    updated_at = now();

ALTER TABLE credit_balances
  DROP COLUMN research_remaining_credits,
  DROP COLUMN research_reserved_credits,
  DROP COLUMN generation_remaining_credits,
  DROP COLUMN generation_reserved_credits;

-- The ledger no longer records a wallet. usage_kind stays as a descriptive
-- label of which AI activity consumed the credits.
ALTER TABLE credit_ledger DROP COLUMN wallet;

-- One credit is a fixed slice of provider cost, not a token count:
-- we pay EUR 0.007 of provider (OpenAI) cost per credit and sell it for
-- EUR 0.02. Charges are ceil(actual provider cost / cost per credit), so the
-- margin holds regardless of model or input/output token mix.
ALTER TABLE credit_pricing RENAME COLUMN token_price_cents TO credit_price_cents;
ALTER TABLE credit_pricing RENAME COLUMN provider_token_cost_micro_eur TO provider_cost_per_credit_micro_eur;
UPDATE credit_pricing
SET credit_price_cents = 2,
    provider_cost_per_credit_micro_eur = 7000,
    updated_at = now()
WHERE singleton = true;
