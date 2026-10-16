ALTER TABLE public.custom_packages
  ADD COLUMN IF NOT EXISTS parent_package_id uuid;

UPDATE public.custom_packages AS child
SET parent_package_id = NULL
WHERE parent_package_id = child.id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.custom_packages'::regclass
      AND conname = 'custom_packages_parent_package_id_fkey'
  ) THEN
    ALTER TABLE public.custom_packages
      ADD CONSTRAINT custom_packages_parent_package_id_fkey
      FOREIGN KEY (parent_package_id)
      REFERENCES public.custom_packages(id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS custom_packages_parent_package
  ON public.custom_packages(parent_package_id);
