# S1-A01 Organizations Domain Design

## Goal

Introduce Organizations as the new identity, tenant and billing root while preserving the existing owner-managed `businesses` and workspace flow.

## Scope

S1-A01 adds Organization create, list, read and update commands; the minimal membership model required to authorize those commands; owner invariants; PostgreSQL RLS; and API/RLS/regression evidence.

It does not add invitations, membership lifecycle management, owner transfer, brand scope, a general capability matrix, brand records, or workspace access for newly invited members. Those remain S1-A02, S1-A03 and S1-A04 work.

## Compatibility Architecture

`organizations` is a separate aggregate. `businesses` remains the legacy one-workspace projection. Existing businesses are backfilled with an Organization of the same UUID and `businesses.organization_id` points to it. Existing child tables continue to use `business_id`; no existing foreign key, endpoint or route is renamed.

For the legacy onboarding endpoint, the same transaction creates the business, its one-to-one Organization bridge and the authenticated Owner membership. The existing `/api/business` response and workspace routes remain unchanged.

## Schema

`organizations` has `id`, `name`, globally unique canonical `slug`, `owner_user_id`, `revision`, `created_at` and `updated_at`.

`organization_members` has `id`, `organization_id`, `user_id`, `role`, `status`, `created_at` and `updated_at`. The supported stored role vocabulary is `owner`, `admin`, `marketer`, `approver`, `analyst` and `billing`; S1-A01 authorizes only Organization reads for active members and Organization updates for owners/admins. A partial unique index permits at most one active membership for a user/organization pair.

`organizations.owner_user_id` is the designated owner. Deferred constraint triggers require that this user has an active Owner membership, and prevent removal or demotion of the last active Owner. No membership mutation endpoint is exposed in this ticket.

The migration is additive. It creates tables, backfills Organization rows and Owner memberships from businesses, then adds a nullable unique `businesses.organization_id` bridge. A later contract migration is intentionally not part of this ticket because old binaries must remain able to write `businesses` during rolling deployment.

## Validation and API Contract

Organization input is server-validated with Zod and duplicated in database checks:

- `name`: trimmed, 2--120 visible characters.
- `slug`: lowercase ASCII, 2--80 characters, `^[a-z0-9][a-z0-9-]{0,78}$`.
- duplicate slug: HTTP 409.
- invalid request data: HTTP 422.

Endpoints:

- `POST /api/v1/organizations`: authenticated; creates Organization + Owner membership atomically.
- `GET /api/v1/organizations`: active member sees only their own Organizations.
- `GET /api/v1/organizations/:id`: active member may read that Organization.
- `PATCH /api/v1/organizations/:id`: active Owner/Admin only; uses a revision precondition.

Organization API responses expose `id`, `name`, `slug`, `revision` and the caller's role. They do not expose other members.

## Authorization and RLS

Handlers require an authenticated user, then call a dedicated Organization service. The service reads the caller's membership under user context, sets `app.user_id` and `app.organization_id` only after authorization, and invokes the repository command.

The RLS policies use `app.current_user_id()` and `app.current_organization_id()`. Security-definer helpers resolve the active tenant schema at call time (with a quoted identifier), so isolated-schema test runs cannot redirect the public policy helpers. They answer active-membership and allowed-role checks without recursive policy evaluation. Runtime users may read their own membership; the narrowly scoped initial Owner insert is allowed only while creating an Organization owned by the same caller.

## Tests and Evidence

Database integration tests cover schema constraints, atomic rollback, owner invariant and business bridge creation. API integration tests cover validation, create/list/read/update and owner/admin/member authorization. The RLS harness covers Org A/B reads/updates, missing context and membership visibility. The existing RLS test uses savepoints around expected SQL permission errors so subsequent assertions stay in a valid transaction.

`test:rls` is a separate explicit command. Results provide task evidence but do not claim RG-02/RG-03 passed: hosted CI wiring and the full capability matrix remain outside this ticket.
