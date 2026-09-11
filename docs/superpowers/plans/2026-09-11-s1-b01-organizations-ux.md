# S1-B01 Organizations UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tenant-safe Organization create/switch experience whose persisted active organization is always revalidated through `/api/v1/organizations`, without changing the legacy `/api/business` single-business flow.

**Architecture:** A single `useOrganizationContext` composable owns the organization list, active organization, persistence, validation, and safe clearing. The dashboard switcher and the first-organization screen consume that composable; they never treat local storage/cookies/routes as authorization. Existing `useWorkspace`, `/api/business`, workspace routes, and business data remain legacy single-business behavior and are not rewritten.

**Tech Stack:** Nuxt 4, Vue 3 Composition API, Nuxt UI primitives, TypeScript, Zod, Vitest, Playwright, Supabase-backed API.

**Spec:** User-approved S1-B01 prompt in the conversation; S1-A01 contract at `docs/superpowers/specs/2026-09-10-s1-a01-organizations-design.md`.

## Global Constraints

- Use `/api/v1/organizations` as the API source for the organization list and creation.
- Persisted `activeOrganizationId` is a preference only; every restore/select path must match the authenticated API list.
- If a persisted ID is absent from the API-visible list (removed membership, suspended membership, tampering, or stale data), clear it before any tenant-data request and require a safe reselect from the current API list; never use the invalid ID even temporarily.
- Do not change `/api/business`, create a business/workspace for every organization, or rewrite the legacy single-business data model.
- Do not modify `apps/web/app/middleware/workspace.ts` unless a concrete, unavoidable S1-B01 blocker is demonstrated; prefer an isolated organization composable/page.
- Do not modify the S1-A01 specification; document S1-B01 boundaries only in a separate S1-B01 document.
- Use existing Nuxt UI primitives and the shared design system.
- Keep organization state in one composable; do not duplicate it in unrelated stores.
- Do not claim completion unless Playwright evidence covers refresh, switching, invalid membership, and tampered IDs.
- Do not commit or push without explicit user approval.

### Task 1: Define safe organization selection behavior with failing unit tests

**Files:**
- Create: `apps/web/app/utils/organization-selection.ts`
- Test: `apps/web/tests/unit/organization-selection.test.ts`

**Interfaces:**
- `selectValidOrganization<T extends { id: string }>(organizations: readonly T[], preferredId: string | null): T | null`
- `isAllowedOrganizationId(organizations: readonly { id: string }[], candidateId: string | null): boolean`

- [x] **Step 1: Write the failing tests** for an empty list, a valid persisted ID, an unknown/tampered ID, and a removed membership where the preferred organization is absent.
- [x] **Step 2: Run the focused test** with `npm.cmd run test:unit --workspace apps/web -- tests/unit/organization-selection.test.ts`; confirm it fails because the helpers do not exist.
- [x] **Step 3: Implement the minimal pure helpers**: return the preferred item only when present; otherwise return the first API-visible item or `null`; never return an unknown ID.
- [x] **Step 4: Re-run the focused test** and confirm it passes.

### Task 2: Add one source of truth for active Organization state

**Files:**
- Create: `apps/web/app/composables/useOrganizationContext.ts`
- Test: `apps/web/tests/unit/organization-context.test.ts`

**Interfaces:**
- State: `organizations`, `activeOrganizationId`, `activeOrganization`, `ready`, `loading`, `error`.
- `loadOrganizations(): Promise<OrganizationView[]>` calls `GET /api/v1/organizations`, validates the response, and reconciles the persisted preference.
- `selectOrganization(id: string): Promise<boolean>` accepts only an API-visible ID, persists it, and returns `false` for unknown IDs without setting or using that ID.
- `clearActiveOrganization(): void` removes the preference and clears the active value.
- `createOrganization(input: OrganizationCreateInput): Promise<OrganizationView>` calls `POST /api/v1/organizations`, refreshes the list, and activates the returned organization.

- [x] **Step 1: Write failing tests** covering valid restore, tampered preference fallback, removed membership clearing/reselecting, and create-and-activate behavior using the real pure selection helper and a small injected fetch adapter.
- [x] **Step 2: Run the focused test** and verify the expected RED failure.
- [x] **Step 3: Implement the composable** with Nuxt `useCookie('rrit-active-organization')` as the preference store; treat the cookie as untrusted, clear it immediately when absent from the API list, and do not issue any organization/tenant-data request using the invalid value.
- [x] **Step 4: Re-run the focused test** and then `npm.cmd run typecheck --workspace apps/web`.

### Task 3: Build the Organization switcher and first-organization empty state

**Files:**
- Create: `apps/web/app/components/OrganizationSwitcher.vue`
- Create: `apps/web/app/components/OrganizationEmptyState.vue`
- Modify: `apps/web/app/layouts/dashboard.vue` (header slot)
- Create: `apps/web/app/pages/organizations.vue` (authenticated organization-only entry point)
- Test: `apps/web/tests/unit/organization-ui.test.ts` (pure UI model; DOM lifecycle is covered by Playwright because this repository has no Vue component-test harness)

**Interfaces:**
- `OrganizationSwitcher` receives no authorization props; it reads the shared composable, renders API-visible organizations, emits no raw-ID authorization decision, and calls `selectOrganization` on selection.
- `OrganizationEmptyState` renders the create form using `organizationCreateSchema`; submission calls `createOrganization` and reports API validation errors.

- [x] **Step 1: Write failing UI-model tests** for slug generation/form validation and the accessible menu model; DOM lifecycle is covered by the Playwright test in Task 5.
- [x] **Step 2: Run the UI-model tests** and verify RED.
- [x] **Step 3: Implement the components** with `UDropdownMenu`, `UForm`, `UInput`, `UButton`, and existing visual tokens; include stable labels/test IDs for Playwright.
- [x] **Step 4: Integrate the switcher** into the dashboard header without changing `businessMenu` or `/api/business`; expose the organization-only page for users who have no organization/workspace yet.
- [x] **Step 5: Re-run component tests, lint, and typecheck**.

### Task 4: Validate organization context during navigation and refresh

**Files:**
- Modify: `apps/web/app/pages/app/index.vue`
- Test: `apps/web/tests/unit/organization-middleware.test.ts`

**Interfaces:**
- Existing workspace authorization remains unchanged.
- Organization preference reconciliation occurs before any organization-only view renders.
- An invalid active organization is cleared; a valid API-visible fallback is selected only when one exists.

- [x] **Step 1: Evaluate whether middleware changes are required.** The isolated composable loads/reconciles before the organization page renders, and the dashboard switcher is organization-only.
- [x] **Step 2: Keep `workspace.ts`, `/api/business`, and the existing app page unchanged.** No S1-B01 blocker required a navigation middleware change.
- [x] **Step 3: Cover refresh and invalid/removed preference behavior in the composable unit tests and Playwright lifecycle tests.**

### Task 5: Add Playwright organization lifecycle evidence

**Files:**
- Create: `apps/web/tests/e2e/organization-lifecycle.spec.ts`
- Modify: `apps/web/tests/e2e/helpers/auth.ts` only if a reusable Supabase service-role membership cleanup helper is required.

**Interfaces:**
- Tests use the running application and real organization API behavior. Service-role setup/cleanup is test setup only and does not bypass the application assertions.

- [x] **Step 1: Add the first-organization create test**: authenticated user with no API-visible organizations sees the empty state, creates one, and sees it active.
- [x] **Step 2: Add the two-organization switch test**: create two organizations through the real API, select the second, and assert the active name/ID changes.
- [x] **Step 3: Add the refresh test**: reload the page and assert the valid selected organization is restored.
- [x] **Step 4: Add the removed-membership test**: revoke the active membership through test cleanup/setup, reload, and assert the invalid context is cleared and a safe reselect is required or a valid fallback is shown.
- [x] **Step 5: Add the tampered-ID test**: write an organization ID not returned by `GET /api/v1/organizations` into the persisted preference and assert that no unauthorized organization is rendered or fetched.
- [x] **Step 6: Run the focused Playwright project** with `npm.cmd run test:e2e --workspace apps/web -- tests/e2e/organization-lifecycle.spec.ts`; real Supabase run passed on desktop and mobile. Test-account cleanup reports existing database FK/RESTRICT warnings.

### Task 6: Document the boundary and verify the complete change

**Files:**
- Create: `docs/superpowers/specs/2026-09-11-s1-b01-organizations-ux.md`

- [x] **Step 1: Document** separately that S1-B01 switches Organization context only; legacy workspace/business remains single-business and the `businesses.organization_id` documentation/migration mismatch is out of scope. Leave the S1-A01 spec unchanged.
- [x] **Step 2: Run** `npm.cmd run lint --workspace apps/web`, `npm.cmd run typecheck --workspace apps/web`, focused unit tests, and focused Playwright tests.
- [x] **Step 3: Inspect `git diff` and `git status`**; do not commit or push.
- [x] **Step 4: Report** an acceptance matrix with exact paths, test results, RG-14 verification, and the Supabase test-account cleanup limitation.
