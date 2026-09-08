# ADR-002 — Production modular monolith on Nuxt/Nitro and PostgreSQL

Status: Accepted, 2026-09-07.

## Context

The initial blueprint expected a separate FastAPI service, worker package and Supabase. The implemented product now has a real Nuxt 4 application, Nitro server routes, Better Auth and PostgreSQL migrations. Rebuilding the same behavior in a second backend before launch would duplicate authentication, authorization and publishing logic while delaying validation with Kosovo businesses.

The product currently serves one owner-managed business and focuses on Facebook/Instagram posts. Campaigns, strategy, team and analytics remain deferred. Meta, OpenAI and billing stay behind server-side capabilities and may never report success without provider confirmation.

## Decision

Use a TypeScript modular monolith for the launch architecture:

- Nuxt renders the public and authenticated web application.
- Nitro owns HTTP APIs, authentication integration and domain commands.
- PostgreSQL is the authoritative data store. Versioned SQL migrations are reviewed and applied outside application startup with a checksum ledger and advisory lock.
- Background work uses separately enabled worker entry points from the same versioned artifact. Provider calls run outside database transactions. Publication jobs retain idempotency targets and ambiguous outcomes for reconciliation.
- Browser code never receives provider secrets or database credentials. All tenant reads and mutations require server-side authorization.
- `/api/health/live` reports process liveness. `/api/health/ready` verifies database access and the current migration before traffic is accepted.
- Meta, OpenAI, mail and billing remain adapters behind domain boundaries. Their availability is returned as a capability, not simulated.

The original FastAPI/Supabase implementation tasks must be interpreted by their security and operational outcomes. TypeScript/Nitro replacements still have to satisfy tenant isolation, least-privilege runtime roles, RLS tests, queues, audit, observability and recovery. This ADR does not waive those requirements.

## Module boundaries

- `server/api`: transport, parsing, authentication and response mapping.
- `server/utils`: domain/application services and provider adapters; no client imports.
- `shared`: validated DTOs and deterministic logic that is safe in both runtimes.
- `database/migrations`: immutable schema history; runtime startup never mutates schema.
- `server/plugins`: process wiring only. Durable state remains in PostgreSQL.
- `app`: Nuxt UI interaction layer; no provider SDKs or secret-dependent success paths.

## Deployment and scaling consequences

The web process and publisher may be deployed from the same artifact but must be independently scalable and observable. Only publisher instances receive `PUBLISHING_ENABLED=true`. PostgreSQL locking and idempotency must remain correct with multiple worker instances. Long-running generation, sync and media processing must move to durable jobs before their related backlog tasks can be closed.

Production uses a migration identity and a separate restricted runtime identity. CI provisions PostgreSQL, applies all migrations, executes integration/E2E checks and starts the built artifact only after readiness succeeds. Progressive rollout, rollback, backup/restore and provider credentials remain release-gate work.

## Alternatives considered

Keeping the original FastAPI/Supabase split is viable for a larger independent backend team, but no working service or contract exists in this workspace. A browser-only repository is rejected because it cannot enforce tenancy, protect tokens or confirm external effects. Automatic schema migration during startup is rejected because concurrent deploys and rollback become unsafe.

## Follow-up requirements

Complete the RLS/runtime-role design, split durable worker deployment, add structured telemetry and runbooks, and prove provider reconciliation under faults. Record a new ADR if scale, team ownership or regulatory constraints justify extracting a service; preserve the HTTP/domain contracts and migration ownership during extraction.
