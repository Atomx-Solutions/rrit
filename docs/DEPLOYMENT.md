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

## Konfigurimi i detyrueshëm

Sekretet vendosen në secret manager të host-it dhe nuk futen në image, repository ose log. Minimumi për web-in përfshin `APP_URL`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_KEY`, `TRIAL_HASH_KEY`, `META_TOKEN_KEY` dhe `MEDIA_SIGNING_KEY`. Publisher-i real kërkon edhe konfigurimin e Meta App.

Origin-i publik në `APP_URL` duhet të jetë HTTPS dhe identik me origin-in e përdorur nga browser-i. Databaza Supabase nuk duhet të ekspozohet publikisht.

## Provat para release-it

Release-i kërkon workflow-n e hostuar të gjelbër, backup/restore rehearsal, Meta staging me llogari jo-developer, SMTP publik, security review, load/soak dhe UAT. Provat lokale nuk zëvendësojnë këto gate të jashtme.
