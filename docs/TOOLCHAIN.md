# RRIT runtime dhe quality toolchain

Status: Baseline e pranuar për S0-A03, pa Docker, 2026-09-09.

## Mapping i arkitekturës

Back-end-i i paimplementuar Python/FastAPI u zëvendësua nga modular monolith-i Nitro/TypeScript sipas [ADR-002](adr/ADR-002-production-modular-monolith.md).

| Kontrata e vjetër | Ekuivalenti RRIT |
| --- | --- |
| Python 3.14 | Node.js 24.21.0 |
| `pyproject` | root/workspace `package.json` |
| Python dependency lock | `package-lock.json` dhe vetëm `npm ci` |
| Ruff | ESLint |
| pytest | Vitest unit/integration |
| pre-commit | `.githooks/pre-commit` i versionuar |

## Baseline-i i fiksuar

- `.nvmrc`, manifestet dhe CI kërkojnë Node.js `24.21.0`.
- Root manifesti kërkon npm `11.19.0`.
- `.npmrc` refuzon engine të papajtueshme dhe kërkon lockfile-in.
- `package-lock.json` është dependency graph i versionuar; instalimi reproducible bëhet me `npm ci`.
- CI dhe zhvillimi lokal përdorin të njëjtat komanda quality.
- Supabase është databaza e jashtme për v1; nuk përdoret databazë lokale dhe nuk ekzekutohet `supabase db push` nga këto kontrolle.

## Komandat reproducible

Nga root-i i repository-t:

```powershell
npm ci
npm run check
npm run verify:local
```

`check` verifikon Node/npm, ESLint, typecheck dhe testet unit. `verify:local` shton vetëm production build dhe nuk kërkon PostgreSQL. `verify` mbetet gate-i i plotë i CI-së me integration dhe security tests. Hook-u i versionuar instalohet nga `npm ci` dhe ekzekuton `npm run check` para commit-it.

Integration tests pranojnë vetëm `DATABASE_URL` ose `MIGRATION_DATABASE_URL` lokale/testuese. URL-të remote të Supabase nuk përdoren për testet destruktive.

## Clean-install acceptance procedure

1. Konfirmo `node --version` = `v24.21.0` dhe `npm --version` = `11.19.0`.
2. Ekzekuto `npm ci`; mospërputhja manifest/lock duhet të dështojë.
3. Ekzekuto `npm run check` dhe `npm run build`.
4. Në CI, konfirmo të njëjtat komanda dhe integration tests me test service-in PostgreSQL të GitHub Actions.
5. Regjistro versionet, exit codes, numrin e testeve dhe build result në `docs/VALIDATION.md`, pa sekrete.

Docker nuk është pjesë e runtime-it, deployment-it ose acceptance gate-it të RRIT.
