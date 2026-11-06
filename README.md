# Framic

Framic është platformë në gjuhën shqipe për krijimin dhe planifikimin e përmbajtjes në rrjete sociale për biznese në Kosovë. Bizneset mund të përshkruajnë markën, të krijojnë postime, t'i rishikojnë dhe t'i vendosin në kalendar.

## Funksionet kryesore

- Regjistrim, hyrje, verifikim emaili, rikuperim fjalëkalimi dhe onboarding.
- Organizata dhe marka me profil biznesi, oferta dhe fakte të verifikuara (Business Brain).
- Content Studio për krijim e redaktim postimesh, galeri private, autosave, kontroll cilësie dhe miratim.
- Planifikues mujor me AI për hulumtim, ide, përmbajtje, imazhe dhe raport mujor. Përdoruesi vendos nëse draftet miratohen ose publikohen.
- Kalendar për planifikim manual dhe publikim përmes llogarive sociale të lidhura.
- Lidhje dhe import të historikut nga Facebook/Instagram, si dhe rrjedha për Instagram Login, TikTok dhe video.
- Plane, trial, kredite, kërkesa për paketa të personalizuara, faturim dhe panel administrimi.

AI, publikimi social dhe pagesat kërkojnë konfigurimin dhe autorizimet përkatëse. Pagesat Paddle janë të çaktivizuara si parazgjedhje. Shiko [Monthly AI Studio](docs/MONTHLY-AI-STUDIO.md) për rrjedhën e planifikimit.

## Teknologjitë

Nuxt 4, Vue 3, TypeScript, Nitro, Nuxt UI, Tailwind CSS, PostgreSQL/Supabase, Supabase Auth, Zod, Vitest dhe Playwright. Integrimet opsionale përfshijnë Meta, TikTok, OpenAI/OpenRouter dhe Paddle.

## Nisja lokale

Kërkohen Node.js **24.21.0** (shiko .nvmrc), npm **11.19.0** dhe PostgreSQL/Supabase për funksionet që ruajnë të dhëna.

1. Instalo varësitë me **npm ci**.
2. Kopjo **.env.example** në **.env** dhe plotëso konfigurimin e nevojshëm. Mos e komito skedarin .env.
3. Nise aplikacionin me **npm run dev**.

Në PowerShell përdor **npm.cmd** nëse skriptet .ps1 janë të bllokuara. Aplikacioni hapet në http://127.0.0.1:3000, hapësira e punës te /app dhe kontrolli i gatishmërisë te /api/health/ready. Për migrimet dhe vendosjen në prodhim shiko [udhëzuesin e deploy-it](docs/DEPLOYMENT.md).

## Komandat kryesore

| Komanda | Qëllimi |
| --- | --- |
| npm run dev | Serveri i zhvillimit |
| npm run check | Toolchain, lint, typecheck dhe teste unit |
| npm run test:integration | Teste integrimi me databazë |
| npm run test:security | Teste sigurie |
| npm run build | Build për prodhim |
| npm run test:e2e | Teste Playwright |
| npm run verify | Kontrollet kryesore, testet e integrimit e sigurisë dhe build |

## Struktura

| Dosja | Përmbajtja |
| --- | --- |
| apps/web/app | Faqet, komponentët dhe ndërfaqja Vue |
| apps/web/server/api | API-të Nitro |
| apps/web/server/utils | Shërbimet e biznesit dhe integrimet |
| apps/web/shared | Skemat, tipet dhe funksionet e përbashkëta |
| apps/web/database | Migrimet SQL |
| apps/web/tests | Testet unit, integration, security dhe e2e |
| docs | Dokumentimi teknik dhe i produktit |

Shiko edhe [arkitekturën](docs/adr/ADR-002-production-modular-monolith.md), [sistemin e ndërfaqes](docs/UI-SYSTEM.md) dhe [toolchain-in](docs/TOOLCHAIN.md).
