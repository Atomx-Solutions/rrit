# S1-B01 Organizations UX Boundary

S1-B01 adds the user-facing Organization lifecycle: create an Organization, list the Organizations visible to the authenticated user, select an active Organization, persist that selection as an untrusted preference, and reconcile it against the API after reload.

The active context is Organization-only. The implementation does not create a `business` or workspace for every Organization and does not change `/api/business`, `useWorkspace`, or the legacy single-business routes. Existing onboarding continues to provision the legacy business and its Organization bridge as already implemented.

`GET /api/v1/organizations` is the source of truth for the switcher. A persisted ID that is absent from that response is cleared before it can be used for any Organization or tenant-data request. The UI never grants authorization; server/API membership checks and RLS remain authoritative.

The existing S1-A01 documentation mentions a `businesses.organization_id` bridge, while the deployed migration set does not expose that column. That documentation/migration discrepancy is recorded as a separate follow-up and is intentionally out of scope for S1-B01.

