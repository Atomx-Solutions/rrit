# Active product scope — 2026-09-06

The user's latest instruction narrows the initial release to a simple product for businesses in Kosovo: understand the business, view its Facebook/Instagram history, create posts, review them and plan their publication. This supersedes the broader marketing-suite navigation in the original backlog.

## Included in the current interface

- A Nuxt UI dashboard and sidebar with Overview, Posts, Calendar, Gallery, Social Posts and My Business. Billing and Settings are secondary navigation.
- Three-step onboarding: social profiles → business description and voice → review and first post. Connection may be skipped, and progress is recoverable.
- A dedicated social-history surface with disconnected account states, connection explanations, imported provider history, channel filters, previews and an authoring entrypoint.
- A simplified business editor for products/services, customers, tone and verified details used in post preparation.
- Manual posts, private images, tab recovery, server persistence, review/approval, scheduling and version history.
- Euro pricing throughout public pricing and billing. Proposed packages are €19, €39 and €79 monthly from the PostgreSQL catalog; the annual illustration applies 20% without losing cents. These are proposed packages, not an approved commercial price list or active checkout.
- Kosovo-oriented seed content, Albanian language and euro preferences. The local timezone is displayed as “Kosovë · ora lokale”; its runtime IANA mapping is Europe/Belgrade. Existing local drafts are retained.
- An original geometric SVG wordmark and transparent monogram, with separate light/dark wordmark assets. The SVGs contain no background rectangle and require no external font.

## Deferred by the user

Campaigns, strategy center, standalone analytics and team/agency workflows are outside the active customer journey. A global route guard redirects their old URLs to Posts. Integrations redirects to Social Posts. Search, assistance, the overview and settings do not promote these deferred areas.

Deferred work must not be marked Done in the original workbook. This is a product-scope decision, not proof that the original 185-task plan has been completed.

## Production functionality still required

Account authorization, import, AI generation, persistence and publishing now have server implementations. Meta and OpenAI operations activate only with valid platform credentials and entitlements; the product never invents a successful provider result. Meta production access still requires App Review and tests with authorized non-developer accounts.

Accounts, business facts, posts, entitlements and provider capabilities are returned by validated server services. Test fixtures remain only in the test suite. Commercial approval, provider production access, full immutable content records and the remaining enterprise controls are tracked in the audited workbook and BACKLOG-REVIEW-SQ.md.
