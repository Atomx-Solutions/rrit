# Nuxt UI and the Albanian product experience

Update, 2026-09-06: the current audience is Kosovo and the product is posts-focused. Navigation now has daily post work and business/social history; the strategy/campaign/analytics group has been removed. The public site, business profile and onboarding were redesigned around this narrower scope. Pricing is EUR. See PRODUCT-SCOPE.md for the current release boundary.

The frontend uses Nuxt 4.5.2 and Nuxt UI 4.11.0, verified against the stable releases on 2026-09-05. Versions are pinned and the npm lockfile records the full dependency graph.

Official release references: [Nuxt 4.5.2](https://github.com/nuxt/nuxt/releases/tag/v4.5.2), [Nuxt UI 4.11.0](https://github.com/nuxt/ui/releases/tag/v4.11.0).

## Shared design tokens

S0-B02 keeps the approved landing design and the dashboard visually consistent through one shared token contract. The source is `apps/web/app/assets/css/main.css`; token names begin with `--rrit-` and cover semantic colour, typography, spacing, radius, elevation and motion. `apps/web/app/utils/design-system.ts` records the same contract for application configuration and unit tests.

- Landing and dashboard use the shared semantic tokens for standard UI: surfaces, text, borders, primary actions, focus, spacing and radii.
- The landing's approved art direction (illustrations, scene gradients and image-specific colours) may retain local values; these are not generic UI tokens.
- Light and dark values are defined together in `main.css`. New UI must use semantic tokens rather than introduce an unrelated hex colour or arbitrary spacing value.
- Nuxt UI v4 remains the primary component system. Use `i-lucide-*` icons through Nuxt UI; do not add a second icon library. Create RRIT wrappers only for product composition or brand-specific presentation.
- The accessibility suite verifies light and dark mode for public pages and the dashboard shell, including serious/critical Axe findings, focus visibility and horizontal overflow.

## Component ownership

| Product surface | Nuxt UI components |
| --- | --- |
| Application structure | UDashboardGroup, USidebar, UDashboardPanel, UDashboardNavbar, UDashboardToolbar |
| Navigation and discovery | UNavigationMenu, UButton, UDashboardSearch, UDashboardSearchButton, UDropdownMenu |
| Public site | UHeader, UMain, UFooter, UContainer, UPageHero, UPageSection, UPageCTA |
| Page hierarchy | UPageHeader, UPageGrid, UPageCard, UCard, USeparator |
| Forms and controls | UForm, UFormField, UInput, UTextarea, USelect, UCheckbox, USwitch, UButton, ULink |
| Workflows and feedback | UStepper, UProgress, UAlert, UBadge, UEmpty, UToast, UModal, USlideover |
| Content and business management | UTable, UTabs, UFileUpload, UAvatar, UPricingPlans, UPricingPlan |
| Assistance | UChatPrompt, UPageCard, UAlert |

Product components such as PageHeader, PostCard, ContentEditor, PlanCards and CopilotPanel compose these official components. Semantic HTML remains appropriate for text, photographs, landmarks and domain layouts such as the publication calendar. There is no second library of handmade buttons, inputs, dialogs or navigation widgets. ESLint rejects raw interactive primitives to keep this requirement enforceable.

## Experience decisions

- Navigation uses everyday language: Postimet, Kalendari, Galeria and Rrjetet sociale. Daily work, planning and business configuration have separate navigation groups.
- The overview emphasizes the next useful action and pending approvals. Counts come from the current local workspace rather than invented business performance.
- Post creation exposes three steps: Shkruaj, Kontrollo and Zgjidh orarin. Field descriptions explain what becomes public and what is only for the user's organization.
- Draft recovery, saving feedback, leave protection and conflict handling protect entered work. Errors keep the entered values available.
- Forms use readable font sizes, coarse-pointer buttons have 44px minimum touch areas, and mobile navigation uses the Nuxt UI drawer. Search is also keyboard accessible.
- Albanian locale, explicit Albanian date labels, EUR formatting and the selected business timezone are applied throughout the workspace. Date validation handles daylight-saving gaps and ambiguous times.
- Inter, a restrained emerald accent, neutral surfaces, consistent spacing and actual business photographs provide the visual direction. Motion is limited and honors reduced-motion preferences.
- Light and dark semantic colors are tuned for readable text. Nuxt UI supplies focus management and keyboard behavior for dialogs, menus and tabs.

Nuxt UI's current Stepper wraps a Reka status announcement that is English and zero-based. Its internal announcement is hidden through the supported theme slot, with a separate Albanian live status alongside each stepper. No dependency source is patched.

The sidebar follows the official [Sidebar example](https://ui.nuxt.com/docs/components/sidebar) supplied by the user and the [dashboard template](https://ui.nuxt.com/templates): `USidebar`, `v-model:open`, `collapsible="icon"`, `rail`, business dropdown in the header, `UNavigationMenu` in the body and account dropdown in the footer. The desktop sidebar is 240px wide (64px collapsed), with a 64px application header. `UDashboardGroup` remains for the dashboard panel/search context; its old sidebar toggle controls are replaced by `UButton` controlling `USidebar` directly. The mobile menu uses the component's own slideover, with Albanian accessible labels and a close button. Closing it does not overwrite the persisted desktop preference.

Dashboard pages compose `DashboardPage`, a shared wrapper around `UDashboardPanel`, `UDashboardNavbar` and `UDashboardToolbar`, following the official Nuxt UI dashboard structure. Each route owns its panel; the layout owns navigation and shared overlays. The title/actions stay in the header, page filters stay in the toolbar, and only the body scrolls. A small persistent footer identifies the private business workspace. On narrower screens actions occupy a second row instead of overflowing the header.

The overview uses four counts from the current workspace, a collapsed post-review section and two compact next-step cards. Post details appear only after pressing “Shiko postimet”. `PostsTable` uses a table on desktop and photo/status rows on mobile. Main workflow buttons and cards use outline styling, while utility actions remain inline/ghost. Calendar controls, gallery search and settings tabs use the panel toolbar. The editor preview stays aligned with the form instead of centering vertically in unused space.

The public landing uses Nuxt UI hero, page sections, cards, CTA and accordion components. The product preview explains the workflow without fake customer results. Proposed prices come from the PostgreSQL EUR catalog and are clearly marked as unavailable for purchase until billing is activated.

## Honest service boundaries

The application uses authenticated server state and PostgreSQL. Provider surfaces read explicit capabilities: Meta import/publishing and OpenAI generation are available only with valid server configuration, while payments remain inactive. UI completion does not by itself close RLS/RBAC, provider review, billing, resilience, observability or release gates; those are tracked per task in the audited workbook.
