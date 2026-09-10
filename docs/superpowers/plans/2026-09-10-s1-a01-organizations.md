# S1-A01 Organizations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement tenant-safe Organizations and owner memberships without replacing existing businesses/workspaces.

**Architecture:** Organizations are a new root aggregate with active memberships and RLS. Existing businesses receive a one-to-one Organization bridge using the existing UUID, so legacy `business_id` data and routes remain compatible.

**Tech Stack:** Nuxt/Nitro, TypeScript, Zod, PostgreSQL, pg, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-10-s1-a01-organizations-design.md`

## Global Constraints

- Do not edit existing migrations; add only immutable migrations.
- Do not remove or rename `businesses`, `workspaces`, existing child tables or routes.
- Do not implement invitations, membership administration, owner transfer, general RBAC capabilities or brand scope.
- Run database/RLS tests only against `localhost`/`127.0.0.1` isolated database configuration.
- Do not mark RG-02 or RG-03 passed without hosted evidence and their remaining task work.

---

### Task 1: Organization schema and RLS migration

**Files:**
- Create: `apps/web/database/migrations/0022_organizations_domain.sql`
- Create: `apps/web/database/migrations/0023_organizations_rls_function_context.sql`
- Test: `apps/web/tests/integration/organizations.service.test.ts`

**Interfaces:**
- Produces `organizations`, `organization_members`, `app.is_active_organization_member(uuid, uuid)`, and `app.has_organization_role(uuid, uuid, text[])`.

- [x] **Step 1: Write the failing database test**

```ts
it('enforces an active owner membership for every organization', async () => {
  await expect(pool.query('INSERT INTO organizations(...) VALUES (...)')).rejects.toMatchObject({ code: '23514' })
})
```

- [x] **Step 2: Run the test and verify migration/schema failure.**

Run: `npm run test:integration --workspace apps/web -- organizations.service.test.ts`

- [x] **Step 3: Add migrations 0022 and 0023.**

Create typed tables, role/status checks, indexes, bridge/backfill, deferred Owner triggers, security-definer RLS helpers, grants and policies. The reconciliation migration makes helpers resolve the active tenant schema at call time.

- [x] **Step 4: Re-run schema tests.**

Run: `npm run test:integration --workspace apps/web -- organizations.service.test.ts`

### Task 2: Organization schemas, services and authorization

**Files:**
- Create: `apps/web/shared/schemas/organization.ts`
- Create: `apps/web/server/utils/organizations.ts`
- Test: `apps/web/tests/integration/organizations.service.test.ts`

**Interfaces:**
- Produces `createOrganizationWithOwner(client, userId, input)`, `listOrganizationsForUser(client, userId)`, `getOrganizationForUser(client, userId, id)`, and `updateOrganizationForUser(client, userId, id, input)`.

- [x] **Step 1: Write failing service tests.**

```ts
expect(await createOrganizationWithOwner(client, userId, { name: 'Org A', slug: 'org-a' })).toMatchObject({ name: 'Org A', role: 'owner' })
await expect(updateOrganizationForUser(client, memberId, id, input)).rejects.toMatchObject({ statusCode: 404 })
```

- [x] **Step 2: Run service tests and confirm missing-module failures.**

Run: `npm run test:integration --workspace apps/web -- organizations.service.test.ts`

- [x] **Step 3: Implement minimal schemas and services.**

Use Zod for request parsing, `withUserTransaction` for transaction ownership, explicit role checks before tenant context, revision-based update and stable 404 responses for inaccessible IDs.

- [x] **Step 4: Re-run service tests.**

Run: `npm run test:integration --workspace apps/web -- organizations.service.test.ts`

### Task 3: HTTP API and legacy onboarding bridge

**Files:**
- Create: `apps/web/server/api/v1/organizations/index.post.ts`
- Create: `apps/web/server/api/v1/organizations/index.get.ts`
- Create: `apps/web/server/api/v1/organizations/[id].get.ts`
- Create: `apps/web/server/api/v1/organizations/[id].patch.ts`
- Modify: `apps/web/server/api/business.post.ts`
- Test: `apps/web/tests/integration/organizations.api.test.ts`
- Test: `apps/web/tests/integration/organizations.service.test.ts`

**Interfaces:**
- Consumes organization services and `organizationCreateSchema`/`organizationUpdateSchema`.
- Produces `/api/v1/organizations` create/list/read/update routes and an Organization bridge for each newly created legacy business.

- [x] **Step 1: Write failing API/bridge tests.**

```ts
expect(await postOrganization(owner, { name: 'Org A', slug: 'org-a' })).toMatchObject({ status: 201 })
expect(await patchOrganization(member, orgA.id, body)).toMatchObject({ status: 404 })
expect(await createLegacyBusiness(owner)).toCreateOrganizationBridge()
```

- [x] **Step 2: Run tests and confirm routes/bridge are absent.**

Run: `npm run test:integration --workspace apps/web -- organizations.api.test.ts`

- [x] **Step 3: Implement thin handlers and atomic bridge call.**

Handlers authenticate, enforce same-origin for writes, parse bounded bodies, and delegate to services. Legacy business creation retains its exact response shape.

- [x] **Step 4: Re-run API and bridge tests.**

Run: `npm run test:integration --workspace apps/web -- organizations.api.test.ts organizations.service.test.ts`

### Task 4: RLS harness and regression command

**Files:**
- Modify: `apps/web/tests/integration/server.test.ts`
- Modify: `apps/web/tests/security/rls/assertions.ts`
- Modify: `apps/web/tests/security/rls/fixtures.ts`
- Modify: `apps/web/tests/security/rls/tenant-isolation.test.ts`
- Create: `apps/web/vitest.rls.config.ts`
- Modify: `apps/web/package.json`

**Interfaces:**
- Produces `withSavepoint` expected-error assertions and `npm run test:rls --workspace apps/web`.

- [x] **Step 1: Write a failing test proving an expected RLS denial does not abort later assertions.**

```ts
await assertDeniedInSavepoint(client, () => client.query(forgedInsert))
expect((await client.query(crossTenantUpdate)).rowCount).toBe(0)
```

- [x] **Step 2: Run RLS test and observe transaction-aborted failure.**

Run: `npm run test:integration --workspace apps/web`

- [x] **Step 3: Add savepoint rollback helper and Organization A/B fixtures/assertions.**

Use `SAVEPOINT`, execute expected-denial query, then `ROLLBACK TO SAVEPOINT` and `RELEASE SAVEPOINT`; do not weaken database policies.

- [x] **Step 4: Add an explicit RLS Vitest config/script and execute it.**

Run: `npm run test:rls --workspace apps/web`

### Task 5: Full verification and scope evidence

- [x] **Step 1: Apply migrations to the local isolated test database.**

Run: `npm run db:migrate`

- [x] **Step 2: Execute focused and complete checks.**

Run: `npm run test:unit --workspace apps/web`; `npm run test:integration --workspace apps/web`; `npm run test:rls --workspace apps/web`; `npm run lint --workspace apps/web`; `npm run typecheck --workspace apps/web`.

- [x] **Step 3: Record only factual evidence.**

Document that RLS is runnable locally, but hosted CI and the full cross-resource RBAC matrix remain open; do not mark RG-02/RG-03 passed.
