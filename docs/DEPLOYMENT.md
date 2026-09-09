# Deploy production pa Docker

RRIT v1 ekzekutohet si aplikacion Node/Nitro në platformën e hostimit. Supabase përdoret si databazë e jashtme përmes secret/environment variables; nuk ka image Docker ose PostgreSQL lokal si pjesë të deploy-it.

## Proceset

| Procesi | `PROCESS_ROLE` | Përgjegjësia |
| --- | --- | --- |
| Web | `web` | HTTP/API dhe SSR |
| Publisher | `publisher` | Merr dhe pajton job-et e publikimit |
| Maintenance | `maintenance` | Retention dhe punët periodike |
| Migrime | komandë e kontrolluar | Aplikon migrimet një herë ndaj databazës së synuar |

Host-i mund t'i ekzekutojë rolet si procese Node të ndara ose si shërbime të veçanta. Docker nuk është parakusht.

## Rendi i deploy-it

1. Përdor Node.js `24.21.0` dhe npm `11.19.0`.
2. Ekzekuto `npm ci` dhe `npm run check`.
3. Ekzekuto migrimet vetëm përmes procesit të aprovuar të release-it ndaj Supabase-it të synuar; mos përdor `supabase db push` nga CI quality checks.
4. Ekzekuto `npm run build`.
5. Nis `node apps/web/.output/server/index.mjs` me secretet e host-it dhe kontrollo `/api/health/live` dhe `/api/health/ready`.
6. Nëse publisher-i është aktiv, nise me `PROCESS_ROLE=publisher` si proces të veçantë dhe kontrollo heartbeat-in.

## Rolet e databazës

Përdor tre kredenciale të ndara në Supabase. `app_runtime` është rol pa login
dhe me RLS; kredencialja e web-it duhet të jetë një anëtar jo-superuser i tij
(për shembull `rrit_web`). Worker-i mund të përdorë `rrit_worker` për punët e
besuara ndër-tenant, por kjo kredenciale nuk lejohet në web/API.

| Secret | Procesi i lejuar | Roli |
| --- | --- | --- |
| `DATABASE_URL` | `web` | `rrit_web`, anëtar i `app_runtime`, pa `BYPASSRLS` |
| `WORKER_DATABASE_URL` | `publisher`, `maintenance` | `rrit_worker` |
| `MIGRATION_DATABASE_URL` | vetëm migration runner | rol administrativ |

Pas vendosjes së `DATABASE_URL` në secret manager-in e host-it, verifikoje me:

```powershell
npm.cmd run db:verify-runtime
```

Komanda është read-only: ajo nuk shfaq URL-në ose password-in dhe dështon nëse
`DATABASE_URL` lidhet me superuser, rol me `BYPASSRLS`, ose rol që nuk është
anëtar i `app_runtime`.

## Konfigurimi i detyrueshëm

Sekretet vendosen në secret manager të host-it dhe nuk futen në image, repository ose log. Minimumi për web-in përfshin `APP_URL`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_KEY`, `TRIAL_HASH_KEY`, `META_TOKEN_KEY` dhe `MEDIA_SIGNING_KEY`. Publisher-i real kërkon edhe konfigurimin e Meta App.

Origin-i publik në `APP_URL` duhet të jetë HTTPS dhe identik me origin-in e përdorur nga browser-i. Databaza Supabase nuk duhet të ekspozohet publikisht.

## Provat para release-it

Release-i kërkon workflow-n e hostuar të gjelbër, backup/restore rehearsal, Meta staging me llogari jo-developer, SMTP publik, security review, load/soak dhe UAT. Provat lokale nuk zëvendësojnë këto gate të jashtme.
