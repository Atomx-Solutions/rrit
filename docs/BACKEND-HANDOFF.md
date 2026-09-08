# Handoff për përfundimin production

Data: 2026-09-08. Platforma është një modular monolith Nuxt/Nitro me PostgreSQL dhe worker publikimi. Ky dokument përmbledh kufirin real të integrimit për ekipin që vazhdon punën. Specifikimi i saktë për çdo task është në backlog-un Excel, kolonat `A`, `F`, `M`, `N` dhe `Y–AD`.

| Kufiri | Implementimi aktual | Kushti që e mbyll për prodhim |
| --- | --- | --- |
| Identiteti | BetterAuth, cookie sessions, regjistrim/hyrje/reset dhe capability endpoint | SMTP publik, MFA/reauth ku kërkohet, abuse/rate-limit dhe suite e plotë e skadimit/revokimit |
| Tenant-i | Business membership kontrollohet në komandat kryesore | Matricë RBAC e plotë, prova negative ndërmjet tenant-ëve dhe vendim i dokumentuar për RLS |
| Trial/entitlements | Trial 72 orë dhe kontrolle të normalizuara për email/Meta/pajisje | Identitet pajisjeje rezistent ndaj abuzimit, reconciliation dhe test konkurrues nën ngarkesë |
| Meta | OAuth, token encryption, page selection, import dhe publishing adapters | Meta App/Business Verification, App Review, llogari reale jo-developer, webhook/reconciliation dhe runbook operacional |
| Postimet | Versione/snapshot-e immutable, approval/validation të lidhura me contentVersion, planifikim dhe recovery | Matricë rolesh/override dhe concurrency/browser acceptance i plotë |
| Worker-i | Claim transaksional, heartbeat, batch i kufizuar dhe fixture me dy worker-a/ambiguous outcome | Proces i veçantë në deployment, metrika/alarme, load/fairness dhe graceful shutdown i provuar |
| Outbox-i | Envelope i versionuar, dedupe key, `SKIP LOCKED`, lease recovery dhe receipt atomik me efektet DB | Hosted failure rehearsal, metrika për retry/dead-letter dhe kapacitet nën ngarkesë |
| Media | Ruajtje private, validim, signed URL dhe tërheqje e të drejtave me anulim të përdorimit të ardhshëm | Object storage i prodhimit, antivirus, retention holds dhe load/failure tests |
| AI | Adapter, quota dhe cost ledger reserve/commit/release me hard budget | Factuality/evaluation, anomaly alerts, live concurrency dhe provider fallback të provuar |
| Billing | Katalog/version/entitlements/limits të tipizuara në PostgreSQL, EUR dhe usage snapshot | Checkout/portal/webhooks realë, subscription lifecycle, tatimet/faturat dhe reconciliation end-to-end |
| Operimi | `/api/health/live`, `/api/health/ready`, migrime, role PostgreSQL migration/runtime, container roles dhe workflow CI | CI i hostuar me required checks, observability, backup/restore, incident/DR dhe deploy/rollback rehearsal |
| Privatësia | Faqe publike, retention policy/job dhe rights withdrawal | Export/delete/purge i qëndrueshëm, provider deletion callbacks, DPA/subprocessors dhe shqyrtim ligjor |

## Konfigurimi i jashtëm

Çdo biznes e lidh vetë faqen Facebook dhe llogarinë Instagram, por të gjithë kalojnë përmes Meta App të platformës. Prandaj `META_APP_ID`, `META_APP_SECRET`, `META_LOGIN_CONFIG_ID` dhe një `META_REDIRECT_URI` publik HTTPS duhet të vijnë nga aplikacioni Meta i operatorit. Pa këtë miratim, lidhja mbetet opsionale dhe postimet manuale mund të krijohen/miratohen/planifikohen; publikimi real te Meta nuk mund të deklarohet production-ready.

Sekretet ruhen vetëm në mjedisin e deployment-it. `.env.example` dokumenton emrat, ndërsa `.env` nuk duhet të kopjohet në ticket, Excel apo log.

## Kontrata operative

- Migrimet ekzekutohen para readiness dhe ruhen në `schema_migrations`.
- Web process dhe publisher worker mund të shkallëzohen veçmas; të dy përdorin të njëjtën databazë dhe të njëjtat versione migrimi.
- `live` kontrollon procesin. `ready` kontrollon databazën dhe migrimin minimal të kërkuar.
- Postimi konsiderohet i publikuar vetëm pas konfirmimit të provider-it; retry duhet të ruajë idempotencën.
- Ndërrimi i faqes Meta nuk duhet të përziejë historikun e dy burimeve; `source_account_id` është pjesë e unicitetit.
- Një task shënohet `Done` vetëm kur acceptance criteria, Test Evidence dhe Gate IDs të rreshtit janë kaluar dhe prova është regjistruar në Excel.
