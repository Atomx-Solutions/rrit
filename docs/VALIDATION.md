# Validimi i ekzekutuar

Data: 2026-09-08. Kodi synon Node.js 24 nga `.nvmrc`, Nuxt 4.5.2 dhe Nuxt UI 4.11.1.

| Kontrolli | Rezultati aktual |
| --- | --- |
| Migrimet PostgreSQL | Migrimet 0001–0017 u aplikuan edhe nga container-i `migrations`; `0017_publication_logical_keys.sql` është versioni minimal i readiness |
| Health | `/api/health/live` ktheu `200`; `/api/health/ready` ktheu databazën dhe migrimet `ready` |
| Vitest unit/integration | 52/52 kaluan |
| ESLint | Kaloi, exit 0 |
| Clean Node 24 Docker build | `npm ci`, Nuxt prepare, `nuxt typecheck` dhe `nuxt build` kaluan me Node 24.20.0 |
| Production container | U ngrit healthy si përdorues jo-root, root filesystem vetëm-lexim, `cap_drop: ALL` dhe `no-new-privileges` |
| Worker container | Roli `publisher` u ngrit veçmas, mbeti healthy dhe `/api/health/live` ktheu `200` |
| PostgreSQL role isolation | Migruesi zotëron skemën; `rrit_runtime` lexoi 13 migrimet dhe kaloi E2E, por DDL u refuzua |
| E2E production | 14/14 kaluan kundër container-it production në Chromium desktop/mobile |
| Accessibility | Axe WCAG 2 A/AA pa gjetje serious/critical në landing, login, signup e dashboard; fokus i dukshëm me tastierë, reduced motion dhe pa overflow në desktop/mobile |
| Dependency audit | 0 moderate, 0 high, 0 critical; 1 low dev-only nga `esbuild` për dev server në Windows |

Testet mbulojnë regjistrimin pa email-verifikim në mjedisin lokal, sesionet valid/forged/revoked/expired, biznesin privat, validimin, pagination, Meta opsionale, miratimin/planifikimin për Facebook e Instagram dhe bazën e aksesueshmërisë për faqet publike/auth/dashboard. Testet unit/integration mbulojnë trial identity, katalogun/limitet, retention-in, AI cost ledger, outbox-in transaksional, Retry-After/backoff/jitter/attempt limits, fault taxonomy, logical-key dedupe, ledger-in immutable të tentimeve dhe reconciliation pa ridërgim.

## Kufiri i evidencës

Këto janë prova lokale të artefaktit production. Hosted CI, Meta/OpenAI/billing me kredenciale reale, Firefox/WebKit/pajisje fizike, load/soak, backup/restore, pentest, UAT dhe release rehearsal mbeten gate të pakaluara. Asnjë task që i kërkon këto prova nuk shënohet `Done`.

Alarmi `low` i auditimit prek vetëm serverin e zhvillimit të `esbuild` në Windows. Varësia vjen transitivisht nga `@nuxt/fonts > fontless`; detyrimi i një majori të papajtueshëm nuk u aplikua. Runtime image është Linux dhe përmban vetëm `.output`, jo dev serverin apo `node_modules`.

## Riprodhimi

```powershell
npm.cmd test --workspace apps/web
npm.cmd run lint --workspace apps/web
docker build --target runtime --tag rrit-web:local .
docker compose --profile app run --rm --build migrate
docker compose --profile app up -d --build web publisher
$env:TEST_BASE_URL='http://127.0.0.1:3000'
npm.cmd run test:e2e --workspace apps/web
```

Rendi i plotë i deploy-it dhe rollback-ut gjendet në `docs/DEPLOYMENT.md`.
