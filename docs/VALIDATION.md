# Validimi i S0-A03

Data e rishikimit: 2026-09-09.

RRIT përdor Node.js/Nitro dhe Supabase si databazë të jashtme për v1. Docker nuk përdoret dhe nuk është acceptance gate.

| Kontrolli | Rezultati |
| --- | --- |
| Node/npm toolchain | Node.js 24.21.0 dhe npm 11.19.0 kaluan `toolchain:check` |
| ESLint | Kaloi, exit 0 |
| Nuxt TypeScript typecheck | Kaloi, exit 0 |
| Vitest unit | 24/24 kaluan |
| Vitest integration | 28/28 kaluan në CI me PostgreSQL test service |
| Nuxt/Nitro production build | Kaloi lokalisht dhe në CI |
| Production readiness | `/api/health/live` dhe `/api/health/ready` verifikohen nga Node production server në CI |
| Dependency audit | Nuk ka moderate/high/critical të pambyllura |

## Riprodhimi lokal

```powershell
nvm use 24.21.0
node --version
npm.cmd --version
npm.cmd ci
npm.cmd run check
npm.cmd run build
```

Për `npm.cmd run verify` dhe integration tests duhet një PostgreSQL test service i dedikuar. Mos përdor URL-në e Supabase v1 për teste destruktive dhe mos ekzekuto `supabase db push`.

## CI

Workflow-i `.github/workflows/frontend.yml` përdor të njëjtat quality commands, ndërton output-in Nuxt me `npm run build`, nis drejtpërdrejt `apps/web/.output/server/index.mjs`, pret `/api/health/ready` me versionin e lockuar të `wait-on` dhe ekzekuton E2E kundër serverit Node. Log-u i serverit ruhet si artifact kur ka dështim.

Hosted GitHub Actions, review i Programmer B dhe RG-01 mbeten prova të jashtme; për këtë arsye ticket-i nuk shënohet `Done` vetëm nga validimi lokal.
