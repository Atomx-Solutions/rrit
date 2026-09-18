-- PRC-03: each organization has separate research and generation wallets.
-- Keep the legacy aggregate columns temporarily for a safe deployed-schema
-- transition; all new credit operations use the wallet-specific columns.
ALTER TABLE credit_balances
  ADD COLUMN research_remaining_credits integer NOT NULL DEFAULT 0 CHECK (research_remaining_credits >= 0),
  ADD COLUMN research_reserved_credits integer NOT NULL DEFAULT 0 CHECK (research_reserved_credits >= 0),
  ADD COLUMN generation_remaining_credits integer NOT NULL DEFAULT 0 CHECK (generation_remaining_credits >= 0),
  ADD COLUMN generation_reserved_credits integer NOT NULL DEFAULT 0 CHECK (generation_reserved_credits >= 0);

-- PRC-01 balances are all even-sized plan grants. Split any balance that
-- existed at rollout deterministically, assigning an odd remainder to
-- generation so no purchased credit disappears.
UPDATE credit_balances
SET research_remaining_credits = floor(remaining_credits / 2.0)::integer,
    generation_remaining_credits = remaining_credits - floor(remaining_credits / 2.0)::integer,
    research_reserved_credits = 0,
    generation_reserved_credits = 0,
    remaining_credits = 0,
    reserved_credits = 0
WHERE research_remaining_credits = 0
  AND generation_remaining_credits = 0
  AND (remaining_credits <> 0 OR reserved_credits <> 0);

ALTER TABLE credit_ledger
  ADD COLUMN wallet text CHECK (wallet IN ('research', 'generation'));

-- Historical consumption records retain their known usage kind. Historical
-- grants were from the former common wallet and deliberately remain null.
UPDATE credit_ledger
SET wallet = usage_kind
WHERE wallet IS NULL AND usage_kind IS NOT NULL;
