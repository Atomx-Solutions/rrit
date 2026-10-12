# Framic — AI Marketing Platform

**Scope-i aktual: postimet për bizneset në Kosovë.** Facebook/Instagram → njohja e biznesit → krijimi, miratimi dhe kalendari i postimeve. Çmimet janë në EUR. Fushatat dhe strategjitë janë shtyrë nga përvoja aktive sipas kërkesës së fundit; shiko [scope-in aktual](docs/PRODUCT-SCOPE.md) dhe [rishikimin e backlog-ut](docs/BACKLOG-REVIEW-SQ.md).

Frontend në shqip, i ndërtuar nga dokumenti **Production Grade System Design v1.1** dhe backlog-u shoqërues. Emri **Framic**, marka shembull dhe paketat tregtare janë propozime të implementimit. Backend-i i launch-it është Nitro/TypeScript sipas [ADR-002](docs/adr/ADR-002-production-modular-monolith.md); baseline-i i riprodhueshëm i zhvillimit përshkruhet te [toolchain-i](docs/TOOLCHAIN.md).

## Nisja lokale

Përdor saktësisht Node.js **24.21.0** (`.nvmrc`) dhe npm **11.19.0**.

```sh
npm ci
npm run dev
```

Në PowerShell ku skriptet `.ps1` janë të bllokuara, përdor `npm.cmd` në vend të `npm`.

- Faqja publike: http://127.0.0.1:3000
- Hapësira e punës: http://127.0.0.1:3000/app
- Konfigurimi fillestar: http://127.0.0.1:3000/onboarding
- Readiness: http://127.0.0.1:3000/api/health/ready

## Statusi real

Ky është aplikacion funksional lokal me Nuxt/Nitro, Better Auth dhe PostgreSQL. Llogaritë, biznesi, postimet, mediat, trial-i, validimet, lidhjet Meta dhe punët e publikimit ruhen në server. Migrimet janë versionuar, kontrollohen me checksum dhe përdorin rol të veçantë nga aplikacioni.

Rrjedha aktive përfshin landing SSR, regjistrim/hyrje/rikuperim, onboarding, dashboard, editor me autosave dhe revision conflict, approval, kalendar manual ose publikim automatik të zgjedhur shprehimisht, galeri private, import Facebook/Instagram, modele, profil biznesi, faturim informues, cilësime, eksport dhe ndihmë.

Meta, OpenAI, emaili publik dhe billing aktivizohen vetëm kur konfigurimi përkatës është valid. Pa Meta mund të krijohen, kontrollohen, miratohen dhe ruhen postimet në kalendar; importi dhe publikimi real kërkojnë Meta App të miratuar. Pagesat nuk janë aktive. Platforma nuk është ende production GA/enterprise; shiko backlog-un e audituar për gates e hapura.

## Kontrolli i cilësisë

Kontrolli standard lokal dhe në CI është:

```sh
npm run check
```

Ai verifikon versionet e toolchain-it, lint-in, tipet dhe testet unit pa kërkuar databazë. Me PostgreSQL lokal të konfiguruar, `npm run verify` shton integration tests dhe ndërton artefaktin production.

```sh
npm run verify
node apps/web/scripts/bundle-budget.mjs
npx playwright install chromium
npm run test:e2e
```

Për artefaktin e njëjtë që përdoret në deploy, ndiq [runbook-un production](docs/DEPLOYMENT.md). Testi i shpejtë i output-it mund të niset në një terminal:

```sh
node apps/web/.output/server/index.mjs
```

Pastaj vendos `TEST_BASE_URL=http://127.0.0.1:3000` dhe ekzekuto `npm run test:e2e`. Mos ekzekuto build, instalim dependencies ose typecheck ndërkohë që serveri i zhvillimit përdor të njëjtat skedarë të gjeneruar. CI përdor Node 24 dhe output-in e prodhimit.

## Struktura

```text
apps/web/app/pages          # Rrugët publike dhe të aplikacionit
apps/web/app/layouts        # Public, auth, dashboard
apps/web/app/components     # Kompozime mbi Nuxt UI v4
apps/web/app/composables    # Workspace server, draft recovery dhe transport API
apps/web/app/data           # Navigimi dhe konfigurimi i UI
apps/web/shared/schemas     # Zod: kontrata lokale dhe tipe të derivuara
apps/web/shared/utils       # Formatim shqip, zona kohore, state transitions
apps/web/server/api         # API Nitro për auth, biznes, media, Meta, AI dhe publikim
apps/web/server/utils       # Domain services dhe provider adapters
apps/web/database           # Migrime SQL immutable
apps/web/tests              # Vitest, Playwright, axe, prova vizuale
docs                       # Dokumentet e nxjerra, vendimet dhe statusi
```

## Integrimi që mbetet

Për vazhdimin e zhvillimit përdor [workbook-un e audituar](AI_Marketing_Platform_Engineering_Master_Backlog_2_Developers_v1.1.xlsx) dhe [raportin aktual në shqip](docs/BACKLOG-REVIEW-SQ.md). Te `02_BACKLOG`, kolonat Y–AD ndajnë zbatimin, punën e mbetur, provën e mbylljes dhe gjetjet në kod për secilin nga 185 task-et. Dokumentet e vjetra të demonstrimit nuk janë burim i statusit aktual.

Arkitektura e pranuar dokumentohet në [ADR-002](docs/adr/ADR-002-production-modular-monolith.md). Teknologjitë: Nuxt **4.5.2**, Nuxt UI **4.11.1**, Vue 3, Nitro, Better Auth, PostgreSQL, TypeScript strict, Tailwind CSS 4, Motion for Vue, Zod, Vitest, Playwright dhe axe. Fontet dhe ikonat shërbehen lokalisht.

Sidebar-i, struktura e dashboard-it, navigimi, formularët, tabelat, kartat, çmimet, ngarkimi i fotografive dhe dialogët përdorin komponentët zyrtarë të Nuxt UI. ESLint ndalon rikthimin e kontrolleve HTML të ndërtuara me dorë. Shiko [sistemin e ndërfaqes dhe vendimet e UX](docs/UI-SYSTEM.md).
