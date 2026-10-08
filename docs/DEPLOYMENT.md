# Deploy production pa Docker

RRIT v1 ekzekutohet si aplikacion Node/Nitro në platformën e hostimit. Supabase përdoret si databazë e jashtme përmes secret/environment variables; nuk ka image Docker ose PostgreSQL lokal si pjesë të deploy-it.

## Proceset

| Procesi | `PROCESS_ROLE` | Përgjegjësia |
| --- | --- | --- |
| Web | `web` | HTTP/API dhe SSR |
| Publisher | `publisher` | Merr dhe pajton job-et e publikimit |
| Maintenance | `maintenance` | Retention dhe punët periodike |
| Planner | `planner` | Hulumtim dhe përgatitje e kalendarit mujor me AI |
| Migrime | komandë e kontrolluar | Aplikon migrimet një herë ndaj databazës së synuar |

Host-i mund t'i ekzekutojë rolet si procese Node të ndara ose si shërbime të veçanta. Docker nuk është parakusht.

Video rendering requires `ffmpeg` with `libx264` and `ffprobe` on the web process PATH (or `FFMPEG_PATH` and `FFPROBE_PATH` pointing to those binaries). The web process composes the provider MP4 and deterministic end-card before a render can become ready. Missing binaries make the render fail explicitly; provision them on every host that handles `/api/posts/:id/video-render`.

## Rendi i deploy-it

1. Përdor Node.js `24.21.0` dhe npm `11.19.0`.
2. Ekzekuto `npm ci` dhe `npm run check`.
3. Ekzekuto migrimet vetëm përmes procesit të aprovuar të release-it ndaj Supabase-it të synuar; mos përdor `supabase db push` nga CI quality checks.
4. Ekzekuto `npm run build`.
5. Nis `node apps/web/.output/server/index.mjs` me secretet e host-it dhe kontrollo `/api/health/live` dhe `/api/health/ready`.
6. Nise publisher-in, maintenance-in dhe planner-in si procese të ndara me `WORKER_DATABASE_URL` dhe rolet përkatëse të `PROCESS_ROLE`. Kontrollo heartbeat-in e publisher/planner dhe `monthlyPlanner: ready` te `/api/health/ready`.

## Rolet e databazës

Përdor tre kredenciale të ndara në Supabase. `app_runtime` është rol pa login
dhe me RLS; kredencialja e web-it duhet të jetë një anëtar jo-superuser i tij
(për shembull `rrit_web`). Worker-i përdor një login të veçantë (për shembull
`rrit_planner`) që është anëtar i `rrit_worker` për punët e besuara ndër-tenant;
kjo kredenciale nuk lejohet në web/API.

| Secret | Procesi i lejuar | Roli |
| --- | --- | --- |
| `DATABASE_URL` | `web` | `rrit_web`, anëtar i `app_runtime`, pa `BYPASSRLS` |
| `WORKER_DATABASE_URL` | `publisher`, `maintenance`, `planner` | `rrit_planner`, anëtar i `rrit_worker`, pa `BYPASSRLS` |
| `MIGRATION_DATABASE_URL` | vetëm migration runner | rol administrativ |

Për konfigurimin fillestar lokal, pasi të jenë aplikuar migrimet, ekzekuto:

```powershell
npm.cmd run db:configure-roles
```

Komanda gjeneron kredenciale të ndryshme për `rrit_web` dhe `rrit_planner`,
i verifikon përmes lidhjeve reale dhe i shkruan vetëm në `.env`. Ajo rrotullon
password-et sa herë ekzekutohet, prandaj nuk duhet përdorur si quality check në CI.

Pas vendosjes së `DATABASE_URL` në secret manager-in e host-it, verifikoje me:

```powershell
npm.cmd run db:verify-runtime
```

Komanda është read-only: ajo nuk shfaq URL-në ose password-in dhe dështon nëse
`DATABASE_URL` lidhet me superuser, rol me `BYPASSRLS`, ose rol që nuk është
anëtar i `app_runtime`.

Pas aplikimit të migrimit të planner-it, verifiko edhe kredencialen e worker-it:

```powershell
npm.cmd run db:verify-worker
```

Kjo komandë është vetëm për lexim dhe nuk shfaq URL apo password. Ajo kërkon
rol jo-superuser, pa `BYPASSRLS`, anëtar të `rrit_worker`, jo anëtar të
`app_runtime`, me politikat e planner-it, publisher-it dhe maintenance-it dhe pa
`DELETE` mbi planifikimet. Kontrollon gjithashtu që RLS është aktive në secilën
tabelë të planner-it.

Pasi të vendosen `AI_PROVIDER`, kredencialja e provider-it të zgjedhur, modeli dhe
çmimet aktuale, por përpara se të aktivizohet feature flag-u, ekzekuto:

```powershell
npm.cmd run ai:smoke
```

Ky kontroll nuk përdor databazën ose të dhëna klientësh; verifikon me thirrje të
vogla reale web search me citime, structured output dhe vision.

Për OpenRouter përdor `AI_PROVIDER=openrouter`, `OPENROUTER_API_KEY` dhe model me
prefiks provider-i, p.sh. `openai/gpt-5.6-terra`. Për OpenAI direkt përdor
`AI_PROVIDER=openai` dhe `OPENAI_API_KEY`. Mos vendos të dy sekretet pa nevojë.

## Konfigurimi i detyrueshëm

Sekretet vendosen në secret manager të host-it dhe nuk futen në image, repository ose log. Minimumi për web-in përfshin `APP_URL`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_KEY`, `TRIAL_HASH_KEY`, `META_TOKEN_KEY` dhe `MEDIA_SIGNING_KEY`. Publisher-i real kërkon edhe konfigurimin e Meta App.

Origin-i publik në `APP_URL` duhet të jetë HTTPS dhe identik me origin-in e përdorur nga browser-i. Databaza Supabase nuk duhet të ekspozohet publikisht.

PÃ«r media storage, `SUPABASE_SERVICE_ROLE_KEY` duhet tÃ« vendoset vetÃ«m nÃ« server secret manager dhe nuk duhet tÃ« ekspozohet nÃ« runtime config publik. `MEDIA_BUCKET` duhet tÃ« jetÃ« `assets`; bucket-i duhet tÃ« mbetet privat.

## Testimi i migration-eve me Supabase-only

Kur nuk ka PostgreSQL lokal, migration-et e reja testohen fillimisht ne nje
schema te izoluar `migration_test`. Per Brand 0025, rendi i sigurt eshte:

1. Ekzekuto `apps/web/database/migration-tests/0025_brands_isolated.sql` ne SQL Editor.
2. Ekzekuto `0025_brands_verify.sql` dhe `0025_brands_rls_verify.sql` dhe ruaj rezultatet.
3. Konfirmo workflow-n CI te gjelber; ai teston migration-et ne PostgreSQL disposable.
4. Vetem pas ketyre hapave ekzekuto migration runner-in e aprovuar ndaj Supabase-it real.

Skriptet e testit perdorin vetem `migration_test`, fixture-a sintetike dhe
transaction rollback per testet me shkrim. Ato nuk lexojne ose ndryshojne
`public.businesses`, `auth.users`, `schema_migrations` ose te dhena reale.
Mos ekzekuto `npm run db:migrate` nga nje ambient ku `DATABASE_URL` ose
`MIGRATION_DATABASE_URL` ende tregojne te Supabase, vetem per testim.

## Provat para release-it

Release-i kërkon workflow-n e hostuar të gjelbër, backup/restore rehearsal, Meta staging me llogari jo-developer, SMTP publik, security review, load/soak dhe UAT. Provat lokale nuk zëvendësojnë këto gate të jashtme.
