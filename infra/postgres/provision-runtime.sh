#!/bin/sh
set -eu

: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
: "${RUNTIME_DB_PASSWORD:?RUNTIME_DB_PASSWORD is required}"

export PGPASSWORD="$POSTGRES_PASSWORD"

psql --host postgres --username rrit --dbname rrit \
  --set ON_ERROR_STOP=1 --set runtime_password="$RUNTIME_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE rrit_runtime LOGIN PASSWORD %L', :'runtime_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rrit_runtime') \gexec

SELECT format('ALTER ROLE rrit_runtime LOGIN PASSWORD %L', :'runtime_password') \gexec

GRANT CONNECT ON DATABASE rrit TO rrit_runtime;
GRANT USAGE ON SCHEMA public TO rrit_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rrit_runtime;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO rrit_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE rrit IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rrit_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE rrit IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO rrit_runtime;
DO $$
BEGIN
  IF to_regclass('public.publication_attempts') IS NOT NULL THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON publication_attempts FROM rrit_runtime;
  END IF;
END
$$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
