# S0-A06 — RLS CI Test Harness

## Scope

The RLS suite creates an isolated PostgreSQL schema, applies every application
migration, and executes assertions as `app_runtime` with transaction-local
`app.user_id` and `app.organization_id` context. Setup data is created through
an administrative connection only; all access assertions run under the runtime
role, which has `NOBYPASSRLS`.

The suite covers two tenants and verifies:

- broad reads reveal only the current tenant's posts and assets;
- broad reads reveal only the current tenant's brands;
- missing tenant context returns no tenant rows;
- an allowed insert, update, and delete succeeds for the owning tenant;
- cross-tenant update and delete affect no rows;
- insert and update tenant spoofing are denied with PostgreSQL error `42501`;
- restricted members see and mutate only explicitly assigned brands;
- archived brands can be deleted only by the owning organization after archive;
- removing or broadening the `posts` policy is observable by the normal
  allow/isolation assertions.

## Supabase safety boundary

The automated migration/RLS verification must use the isolated PostgreSQL
service or a local PostgreSQL URL only. It must not apply migrations to the
Supabase project. The RLS harness rejects non-loopback database URLs, and CI
sets `DATABASE_URL` to its disposable PostgreSQL service before running the
security suite and migration command.

## Automation status

The repository now exposes `npm run test:security`, and the hosted frontend
workflow runs it after the integration suite against its PostgreSQL service.
The harness remains separate from unit tests because it creates an isolated
schema and executes assertions as `app_runtime` with `NOBYPASSRLS`.
