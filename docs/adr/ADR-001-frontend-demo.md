# ADR-001 — Frontend-first with isolated demonstration data

Status: Superseded by [ADR-002](ADR-002-production-modular-monolith.md).

This record describes the first frontend demonstration and is retained for history. It is not the architecture or status of the current application.

## Context

The user authorized completing the frontend using the supplied v1.1 design and backlog. The workspace contained the source DOCX/XLSX only. No API, generated OpenAPI specification, authentication project or provider configuration was present. The blueprint prohibits successful UI results for unconfirmed external side effects.

## Decision

Use Nuxt 4.5.2 and Nuxt UI 4.11.0 in `apps/web`. Public pages render with SSR. The isolated local demonstration routes render on the client because their source of truth is browser storage, preventing hydration differences between server fixture state and locally edited state. A future authenticated implementation may use SSR with verified server sessions.

Only `/app/demo/mulliri/*` is available as a sample workspace. Route middleware and a server routing check reject arbitrary demonstration context. This is not a substitute for backend tenancy authorization. `/admin` is visibly a preview and contains no real tenant records or operations.

Local DTOs derive from Zod schemas. Do not label them as generated from a backend OpenAPI document. A single API transport scaffold exists, but must be completed with generated backend contracts and verified session handling before integration. The demo repository must never serve as a fallback for failed real API requests.

No calls to AI, Meta, identity, billing or messaging providers occur. Their UI surfaces explain the missing service. Local state transitions never allow `published` as a mutation. Payments, invitations and organization deletion do not report success.

## Consequences

The frontend can be reviewed and exercised immediately. Publishing, auth, RBAC, signed uploads, entitlements, request correlation, server ETags, policy verification, live analytics and administrative actions remain release dependencies. Prices and quota examples require commercial approval. Legal texts describe the demo and must be replaced with reviewed operational policies before public GA.

Photos are local illustrative Unsplash assets, not evidence of a customer's real premises or products. Fonts and icons are local to avoid external requests during app use.
