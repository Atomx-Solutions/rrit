-- Preserve publication consent for jobs already created. All other dates are calendar entries.
UPDATE posts p SET payload = jsonb_set(payload, '{publicationMode}', to_jsonb(
  CASE WHEN EXISTS (
    SELECT 1 FROM publication_jobs j WHERE j.post_id=p.id
      AND j.post_version=(p.payload->>'version')::integer
      AND j.status IN ('pending','processing','uncertain','published')
  ) THEN 'automatic'::text ELSE 'manual'::text END
)) WHERE NOT payload ? 'publicationMode';
