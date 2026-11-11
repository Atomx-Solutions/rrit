-- A business's products and services live beside its facts and offers in
-- business_facts, so everything the business states about itself has one home.
-- A product may carry a price, like an offer, but has no dates of its own.
DO $$
DECLARE
  constraint_name text;
BEGIN
  -- The kind check was created inline, so its name is not ours to assume. Only
  -- the list of kinds is replaced; the check that a verified offer has dates
  -- also mentions the kind and is kept.
  FOR constraint_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.business_facts'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%kind = ANY%'
  LOOP
    EXECUTE format('ALTER TABLE public.business_facts DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE public.business_facts
  ADD CONSTRAINT business_facts_kind_check CHECK (kind IN ('fact', 'offer', 'product'));
