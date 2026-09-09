# S0-A06 — RLS CI Test Harness

## Scope

The RLS suite creates an isolated PostgreSQL schema, applies every application
migration, and executes assertions as `app_runtime` with transaction-local
`app.user_id` and `app.organization_id` context. Setup data is created through
an administrative connection only; all access assertions run under the runtime
role, which has `NOBYPASSRLS`.

The suite covers two tenants and verifies:

- broad reads reveal only the current tenant's posts and assets;
- missing tenant context returns no tenant rows;
- an allowed insert, update, and delete succeeds for the owning tenant;
- cross-tenant update and delete affect no rows;
- insert and update tenant spoofing are denied with PostgreSQL error `42501`;
- removing or broadening the `posts` policy is observable by the normal
  allow/isolation assertions.

## Manual Supabase SQL Editor verification

Run the RLS checks against the configured Supabase project through SQL Editor.
Use two users, two businesses, and representative rows; then execute broad
SELECT, INSERT, UPDATE, and DELETE statements after setting the intended
`app.user_id` and `app.organization_id` context. Confirm that each user sees
and mutates only its own business rows, and that tenant spoofing is rejected.

## Automation status

There is no separate test database or RLS CI job configured. The Node harness
under `apps/web/tests/security/rls` remains available for a future automated
database environment, but it is intentionally excluded from normal test and
CI commands. Manual Supabase SQL Editor validation is the current approach.
