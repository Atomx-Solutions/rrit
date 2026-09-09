# Landing page — 2026-09-09

Latest verification, Instagram preview: all 28 landing/accessibility cases, lint and typecheck passed. The sequence regression checks that the preview stays hidden before the simulated click, appears for two seconds with the same image and readable copy, then restores the original composition. Reduced motion retains the borderless static image; no mutation requests are sent. Desktop, mobile and dark-mode screenshots were inspected. The preceding photographic revision also passed the production build and bundle budget.

The Kosovo landing now leads with “Postime që bien në sy.” A split hero puts the examples alongside the message. The former benefits grid, interactive workflow, separate onboarding pitch, five-question introduction and oversized closing CTA are removed from the route. A compact process strip leads into two visual stories, three live plans, three collapsed answers and a short final registration prompt.

## Art direction and motion

Three original CSS/HTML post compositions use real local photographs: coffee, a burger and an interior. Citrus green, orange and dark photographic typography give each example its own identity. They are labeled illustrative; brand names, locations and copy in them are fictional, not client work or live generator output.

CSS perspective and translateZ create a three-card shuffle, with orbital rings and a shaded sphere behind it. Each card comes forward during a 15-second cycle. A pause/resume button is available; motion pauses when the showcase is outside the viewport. Reduced-motion preferences disable animations entirely and retain readable static cards. IntersectionObserver and media listeners are removed on unmount. No WebGL, remote embeds, additional library or mandatory interaction is needed.

The mobile hero keeps the same compact card composition; it no longer requires scrolling through three full-height examples before reaching the plans. Nuxt UI supplies the navigation, cards, buttons, pricing plans, tabs, alerts and accordion.

The two `LandingStories` sections continue that art direction. The studio pairs a source photo with its editorial composition. Tennis now uses the real `tennis-ball-court.jpg` photograph, including the actual ball, court texture and natural shadow. A soft CSS mask blends its edges directly into the page in both appearances. The creation phase has no rectangular backdrop, illustrated court, artificial ball or tilted card. The cycle is 10 seconds: the photo appears within 0.6 seconds, the headline by 1.8 seconds, and the signature by 2.5 seconds. The simulated “Posto” click occurs around 4.5 seconds. From 4.9 to 6.9 seconds, a Nuxt UI card presents an Instagram-style preview with an illustrative account, the same photograph and text, familiar action icons, and an explicit simulation confirmation. It fades out by 7.2 seconds, and the borderless composition returns by 7.4 seconds. `LandingTennisPost` renders both appearances so their image and copy stay consistent. The preview is decorative, hidden from assistive technology and has no interactive controls or fabricated engagement counts. The scene never calls publication endpoints or claims actual AI generation or publishing latency. With reduced motion, the photograph and typography are complete and static. `LandingScene` retains independent pause, pointer tilt and viewport/reduced-motion handling; horizontal travel is clipped to prevent mobile overflow.

Page motion uses short, once-per-element Web Animations API entrances for the hero text, process strip, feature copy, live plan cards, FAQ and closing CTA. Content is visible before hydration and when motion is disabled. Dynamically loaded plans are observed too. Active entrances cancel immediately when reduced motion is selected; observers/listeners/animations are cleaned up on unmount. Visual scenes tilt slightly with a fine mouse pointer, reset on pointer exit/pause/offscreen, and disable pointer tilt on touch or reduced motion. The site remains Nuxt; no Astro migration, WebGL scene or remote animation embed is required. Regression coverage includes pointer reset, independent pause and reduced-motion visibility.

Both the landing and `/pricing` use `LandingPricing` and `PlanCards`. The reference-inspired packages have light surfaces, subtle outlines, a pale green recommended package and clear post allowances. All prices and unit-value labels remain derived from the catalog. The pricing route stays available because the footer and detail link use it; its former modal and separate billing switch were removed. It uses the same monthly/annual tabs, loading, retry, empty and capability states as the landing. It hides its self-referencing detail link. The FAQ remains a borderless Nuxt UI accordion with visible keyboard focus.

The closing section pairs a compact 32–44 px headline and short description with a Nuxt UI text action and a small circular arrow. The action follows real registration capabilities. Desktop places the action alongside the copy; mobile stacks it below. The shared public footer uses a distinct sage surface (deeper green in dark mode), two navigation groups, a proportionate original Rrit wordmark (102 px desktop, 84 px mobile) and existing legal links. It uses Nuxt UI Footer, Container and Link components without an enclosing card. The layout was checked at 320 px as well as mobile and desktop widths. A Nuxt UI `UColorModeButton` exposes sun/moon icons in the shared header, including mobile; Nuxt Color Mode persists the visitor’s choice across navigation and reloads.

## Catalog and recommendation

All prices, quotas, annual discounts and features come from `/api/plans`. The starting price is the cheapest current offer, without a hardcoded fallback. Per-post cost is the effective monthly price divided by the plan's post allowance, assuming full use. Annual billing shows the total annual charge.

The editorial recommendation selects the cheapest adequate plan for a 30-post monthly rhythm. The lowest cost-per-post badge is calculated independently across the actual catalog. If prices change, the recommendation, badge and savings update. Savings compare against the entry plan and disappear if not positive.

Migration `0018_volume_plan_value.sql` changes only the original, non-purchasable €79/60-post version-1 offer to €69 and version 2. Customized/live offers and existing entitlement snapshots remain untouched. Current local monthly offers:

| Offer    | Posts/month | EUR/month | EUR/post |
| -------- | ----------: | --------: | -------: |
| Fillimi  |          12 |        19 |     1.58 |
| Përditë  |          30 |        39 |     1.30 |
| Më shumë |          60 |        69 |     1.15 |

### Existing local migration drift

The regular migration runner stopped before the new migration: stored checksums for `0015_publication_retry_policy.sql` and `0016_publication_attempt_ledger.sql` do not match the repository files. LF/CRLF, BOM and trailing-newline variants do not account for the difference. The old files and checksum ledger were not rewritten.

The guarded UPDATE from 0018 was applied as a separate transaction to the local catalog, with the existing migration advisory-lock key and short timeouts. The updated catalog was verified as version 2, €69, 60 posts. **0018 is not marked as applied in schema_migrations.** Once the historical drift is reconciled, the normal runner can record 0018; its UPDATE safely skips an already-adjusted offer. Resolve the pre-existing drift before relying on the full migration/release pipeline.

## Capabilities and claims

Registration/trial labels follow `/api/capabilities`; failed or empty catalog states are explicit. Disabled AI, publishing and payment capabilities remain disclosed. No agency market-rate statistics, customer counts, guaranteed growth or conversion results are invented.

## References

Visual research, not copied assets or claims about the highest-priced work in Kosovo:

- [Oana Gavrila — AI landing / 3D animation, Dribbble](https://dribbble.com/shots/26981604-AI-Landing-page-web-design-3D-Animation)
- [Sana — social post advertising layout, Dribbble](https://dribbble.com/shots/26573381-Social-media-post-design)
- [3D card arrangements, Pinterest](https://in.pinterest.com/pin/3d-virtual-cards-mockups--409898003593223722/)
- [ZHRM Agency, Prishtina — local portfolio direction](https://zhurme.com/)
- [Faishal Hanif — Tennis club poster design, Dribbble](https://dribbble.com/shots/25069109-Tennis-club-poster-design)
- [CSS 3D card references, Pinterest](https://in.pinterest.com/pin/css-3d-cards-in-2025--1126885138024921948/)

Some Pinterest/Dribbble full pages were inaccessible; search-indexed references and the accessible local-agency portfolio informed the research. All shipped compositions are original.

## Checks

Run `npm run test:e2e --workspace apps/web -- --grep landing` for photo loading, registration, dynamic monthly/annual costs, honest value badges, empty/failed APIs, capability states, pause/resume, reduced motion, 320–1440 px overflow, dark mode, SSR hydration and the public accessibility baseline. The tests do not create accounts or posts.

Also run `npm run lint`, `npm run typecheck`, `npm run build`, and `node apps/web/scripts/bundle-budget.mjs`. Frontend verification does not establish conversion results or resolve the historical migration drift above.

Validation on 2026-09-08: lint, typecheck, production build and bundle budget passed. Fourteen functional desktop/mobile cases passed; the two accessibility cases passed after correcting the recommendation badge contrast. A transaction-scoped temporary PostgreSQL table verified the 0018 guard, preservation of customized/live/different-quota offers, and safe replay; the fixture was rolled back.

Follow-up validation: all 20 landing/public-accessibility desktop and mobile cases passed, including the new scenes' independent pause/resume, offscreen pause, reduced motion, local photo loading, mobile reading order, and the recommendation's border/surface treatment. Lint, typecheck and production build passed. A stale local Nuxt process needed a restart to resolve the already-installed Supabase SSR package; no authentication code or package versions were changed for this design task.

Tennis revision, 2026-09-09: replaced the calendar composition and removed its unused data/CSS; updated the scene regression selector. All 20 landing/accessibility cases passed with controlled API fixtures. Lint and typecheck passed. Manually inspected the real page at 1440 px and 390 px. The local live plan API currently returns ECONNREFUSED for PostgreSQL at 127.0.0.1:15432; the Docker daemon is unavailable. The page correctly shows its catalog error state. Fixture-based UI checks do not verify the unavailable live database.

Latest verification: 22 landing/accessibility cases passed, plus focused desktop/mobile checks that reduced motion displays the finished tennis copy and signature. Lint and typecheck passed. The earlier local pricing outage was caused by Docker Desktop being stopped. After starting Docker Desktop, the existing PostgreSQL container became healthy; both localhost:3000/api/plans and 127.0.0.1:3000/api/plans returned HTTP 200 with the actual €19/€39/€69 catalog. No prices, database schema or credentials were changed for this recovery. Docker/PostgreSQL must be running for the live catalog.

Latest motion/footer follow-up: all 24 landing/accessibility cases passed, along with lint and typecheck. The added sequence check verifies the blank start, court drawing, finished composition, simulated publish state and short profile preview; it also confirms no mutating API request is sent. Reduced motion and pre-hydration rendering retain the completed static post. The footer’s light/dark contrast and 320–1440 px layouts were checked.

Photographic revision: the regression now requires a fully visible real photo at the beginning, middle and end of the cycle; it verifies that the SVG court and CSS ball are absent, the second photo appears, and reduced motion retains the finished composition. The photographed ball uses the same light and shadow as its court. Source attribution is in ASSETS.md.

Closing/footer refinement: all 24 landing/accessibility cases, lint and typecheck passed. Inspected the compact closing and proportionate footer logo at 320, 390, 768, 1024 and 1440 px with no horizontal overflow; desktop dark mode retains the correct background and light wordmark. Registration/help actions still follow live capabilities.

Previous object-assembly/pricing/theme revision (tennis direction superseded): all 28 landing/accessibility desktop and mobile cases passed, plus lint, typecheck, production build and bundle budget. Tests now verify the empty first frame, ordered object entrances, raster handoff after the simulated click, no mutating API requests, and the reduced-motion composition. Pricing navigation preserves catalog content and monthly/annual calculations; plan actions follow capabilities. The theme switch remains visible at 320–1440 px and its choice survives navigation and reloads. Hidden 3D objects no longer cause horizontal overflow. Local live catalog screenshots also confirmed the real EUR offers in both appearances.
