-- Plan codes follow the English names. Subscriptions reference the code, so the
-- foreign keys cascade the rename instead of blocking it; historical invoices
-- keep the code stored on them and are not touched.
ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_plan_code_fkey,
  DROP CONSTRAINT IF EXISTS subscriptions_pending_plan_code_fkey;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_plan_code_fkey
    FOREIGN KEY (plan_code) REFERENCES public.plans(code) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD CONSTRAINT subscriptions_pending_plan_code_fkey
    FOREIGN KEY (pending_plan_code) REFERENCES public.plans(code) ON UPDATE CASCADE ON DELETE RESTRICT;

UPDATE public.plans SET code = 'package-' || substring(code from 6) WHERE code LIKE 'pako-%';
