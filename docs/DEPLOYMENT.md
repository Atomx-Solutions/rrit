# Deploy production

Ky runbook përshkruan artefaktin production të platformës dhe rendin e sigurt të deploy-it. Imazhi ndërtohet me Node.js 24 nga digest-i i fiksuar në `Dockerfile`; build-i ndalet nëse `npm ci`, Nuxt prepare, typecheck ose build dështojnë.

## Proceset

I njëjti artefakt ekzekutohet me role të ndara:

| Roli | `PROCESS_ROLE` | Përgjegjësia |
| --- | --- | --- |
| Web | `web` | HTTP/API; nuk ekzekuton publisher ose maintenance |
| Publisher | `publisher` | Merr dhe pajton job-et e publikimit; nuk ekzekuton maintenance |
| Maintenance | `maintenance` | Retention dhe punët periodike; nuk publikon |
| Migrime | target-i `migrations` | Aplikon migrimet një herë para proceseve të aplikacionit |

`compose.yaml` është referenca lokale e topologjisë. Në platformën e hostimit këto role duhen krijuar si shërbime të veçanta nga i njëjti image digest.

## Rendi i deploy-it

1. Ndërto imazhin nga lockfile-i: `docker build --target runtime --tag rrit-web:<version> .`.
2. Ekzekuto target-in `migrations` vetëm një herë kundër databazës së synuar.
3. Ngrije web-in me `PUBLISHING_REQUIRED=false` dhe kontrollo `/api/health/live` e `/api/health/ready`.
4. Ngrije publisher-in dhe maintenance-in si procese të veçanta.
5. Pasi heartbeat-i i publisher-it të jetë i dukshëm, vendos `PUBLISHING_REQUIRED=true` në web dhe kontrollo readiness përsëri.
6. Ekzekuto smoke test-et për regjistrim, tenant isolation, krijim/miratim/planifikim postimi dhe import/publikim Meta kur kredencialet e staging-ut ekzistojnë.

Shembulli lokal:

```powershell
docker compose --profile app config --quiet
docker compose --profile app run --rm --build migrate
docker compose --profile app up -d --build web publisher maintenance
Invoke-RestMethod http://127.0.0.1:3000/api/health/ready
```

## Konfigurimi i detyrueshëm

Sekretet vendosen në secret manager të mjedisit dhe nuk futen në image, repository apo log. Emrat dhe formatet dokumentohen në `.env.example`. Migrimet marrin URL-në e rolit pronar përmes `MIGRATION_DATABASE_URL`; web, publisher dhe maintenance marrin `DATABASE_URL` për rolin runtime pa pronësi skeme. Minimumi për web-in përfshin edhe `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `TRIAL_HASH_KEY`, `META_TOKEN_KEY` dhe `MEDIA_SIGNING_KEY`. SMTP mund të çaktivizohet vetëm në zhvillim. Publisher-i real kërkon edhe konfigurimin e Meta App.

Origin-i publik në `BETTER_AUTH_URL` duhet të jetë HTTPS dhe identik me origin-in e përdorur nga browser-i. Databaza nuk duhet të ekspozohet publikisht.

## Kufijtë e container-it

Proceset ekzekutohen me përdoruesin `rrit` (UID 10001), root filesystem vetëm-lexim, `/tmp` të kufizuar, të gjitha Linux capabilities të hequra dhe `no-new-privileges`. Liveness kontrollon vetëm procesin. Readiness kontrollon PostgreSQL, versionin minimal të migrimeve dhe, kur kërkohet, heartbeat-in e publisher-it.

## Rollback

Mos kthe migrimet mbrapsht duke fshirë tabela në deploy. Ndal rollout-in, rikthe image digest-in e mëparshëm dhe mbaje databazën në versionin më të ri kompatibil. Çdo migrim duhet të jetë backward-compatible gjatë dritares së rollout-it. Nëse migrimi është destruktiv, përdor fillimisht expand, më pas deploy të kodit dhe vetëm në një release të mëvonshëm contract.

Pas rollback-ut kontrollo readiness, login-in, tenant isolation dhe queue-n e publikimeve. Job-et me rezultat të paqartë pajtohen para retry-t që të shmanget publikimi i dyfishtë.

## Provat para release-it

Release-i kërkon workflow-n e hostuar të gjelbër, backup/restore rehearsal, Meta staging me llogari jo-developer, SMTP publik, security review, load/soak dhe UAT. Provat lokale nuk zëvendësojnë këto gate të jashtme.
