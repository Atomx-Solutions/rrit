# S0-A03 — Raport i ndryshimit

## Përmbledhje

S0-A03 vendos toolchain-in e backend-it Nitro/TypeScript sipas ADR-002. Node.js `24.21.0`, npm `11.19.0`, lockfile-i, ESLint, typecheck, Vitest, pre-commit dhe komandat e njëjta lokale/CI janë të versionuara.

Vendimi i përditësuar për v1 është që RRIT nuk përdor Docker. Databaza është Supabase përmes konfigurimit në `.env`; asnjë `supabase db push` nuk kryhet nga quality checks.

## Çfarë u hoq

- `Dockerfile`, `.dockerignore` dhe `compose.yaml`.
- Docker build/run/readiness steps nga GitHub Actions.
- Script-i `db:up` dhe konfigurimi i vjetër lokal të PostgreSQL përmes Docker.
- Dokumentacioni që e paraqiste container-in si runtime ose acceptance gate.

CI tani ndërton Nuxt-in me `npm run build`, nis output-in production drejtpërdrejt me Node dhe kontrollon `/api/health/ready`. PostgreSQL service në CI përdoret vetëm si test fixture, jo si databazë production e projektit.

## Acceptance evidence

| Kriteri | Gjendja |
| --- | --- |
| Clean `npm ci` nga lockfile | E konfiguruar me `package-lock.json` dhe `.npmrc` |
| Node/npm exact versions | E verifikuar me `scripts/check-toolchain.mjs` |
| Lint | `npm run lint` |
| Typecheck | `npm run typecheck` |
| Unit tests | `npm run test:unit` |
| Integration tests | Në CI me PostgreSQL test service |
| Production build | `npm run build` |
| Local/CI parity | `npm run check` dhe `npm run verify` |
| Docker criterion | N/A — Docker nuk është në scope të v1 |
| Pre-commit | `.githooks/pre-commit` i versionuar |
| Documentation/evidence | Ky raport, `TOOLCHAIN.md` dhe `VALIDATION.md` |

## Statusi

Kodi është gati për review. Hosted GitHub CI, Programmer B review dhe RG-01 duhet të konfirmohen para statusit formal `Done`.
