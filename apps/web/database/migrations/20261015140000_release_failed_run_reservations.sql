-- A monthly AI call that failed before the provider charged anything marked
-- its run failed but left its credit reservation in place, so the balance
-- showed credits that could never be spent. New failures now release their
-- reservation; this returns the ones left behind by earlier failures.
WITH stranded AS (
  SELECT reservation.organization_id, reservation.reference_id, reservation.usage_kind,
         pg_catalog.sum(reservation_amount.credits)::bigint AS credits
    FROM public.credit_ledger AS reservation
    JOIN public.monthly_ai_runs AS run ON run.id::text = reservation.reference_id
    -- The ledger records a reservation without its size; it is the run's
    -- reserved cost in credits, as credits.ts creditsForProviderCost works it out.
    CROSS JOIN public.credit_pricing AS pricing
    CROSS JOIN LATERAL (
      SELECT GREATEST(1, CEIL(run.reserved_cost_micro_eur::numeric / pricing.provider_cost_per_credit_micro_eur))::bigint AS credits
    ) AS reservation_amount
   WHERE pricing.singleton
     AND reservation.event_type = 'reserve'
     AND reservation.reference_type = 'monthly_ai_run'
     AND run.status = 'failed'
     AND NOT EXISTS (
       SELECT 1 FROM public.credit_ledger AS settled
        WHERE settled.organization_id = reservation.organization_id
          AND settled.reference_id = reservation.reference_id
          AND settled.event_type IN ('release', 'consume')
     )
   GROUP BY reservation.organization_id, reservation.reference_id, reservation.usage_kind
), released AS (
  INSERT INTO public.credit_ledger
    (organization_id, event_type, usage_kind, credit_delta, reference_type, reference_id, idempotency_key, metadata)
  SELECT organization_id, 'release', usage_kind, 0, 'monthly_ai_run', reference_id,
         'monthly-ai-failure-release:' || reference_id,
         pg_catalog.jsonb_build_object('credits', credits, 'reason', 'failed_run_reconciled')
    FROM stranded
   WHERE credits > 0
  ON CONFLICT (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING organization_id, (metadata->>'credits')::bigint AS credits
)
UPDATE public.credit_balances AS balance
   SET reserved_credits = GREATEST(balance.reserved_credits - totals.credits, 0),
       updated_at = pg_catalog.now()
  FROM (SELECT organization_id, pg_catalog.sum(credits)::bigint AS credits FROM released GROUP BY organization_id) AS totals
 WHERE balance.organization_id = totals.organization_id;

-- A package that ended while these reservations stood kept them aside as work
-- in progress. With the reservations gone, credits of a business that has no
-- package in force end now, as the package's other credits did.
WITH ended AS (
  SELECT balance.organization_id, balance.remaining_credits - balance.reserved_credits AS unused
    FROM public.credit_balances AS balance
   WHERE balance.remaining_credits > balance.reserved_credits
     AND EXISTS (
       SELECT 1 FROM public.credit_ledger AS release
        WHERE release.organization_id = balance.organization_id
          AND release.idempotency_key LIKE 'monthly-ai-failure-release:%'
          AND release.metadata->>'reason' = 'failed_run_reconciled'
     )
     AND EXISTS (
       SELECT 1 FROM public.custom_packages AS package
        WHERE package.organization_id = balance.organization_id
          AND package.status IN ('expired', 'cancelled')
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.custom_packages AS package
        WHERE package.organization_id = balance.organization_id
          AND package.status = 'active'
          AND package.starts_at <= pg_catalog.now()
          AND package.ends_at > pg_catalog.now()
     )
), expired AS (
  INSERT INTO public.credit_ledger
    (organization_id, event_type, credit_delta, reference_type, reference_id, idempotency_key, metadata)
  SELECT organization_id, 'expire', -unused, 'credit_balance', organization_id::text,
         'reconciled-reservation-expire:' || organization_id::text,
         pg_catalog.jsonb_build_object('reason', 'package_ended_after_reconciliation')
    FROM ended
  ON CONFLICT (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING organization_id
)
UPDATE public.credit_balances AS balance
   SET remaining_credits = balance.reserved_credits, updated_at = pg_catalog.now()
  FROM expired
 WHERE balance.organization_id = expired.organization_id;
