# Raporti i implementimit — S0-A03

Data: 2026-09-08
Gjendja e kodit: **Implementuar plotësisht**
Statusi formal: **In Review**

## Vendimi

Kërkesa e vjetër për Python 3.14 është përshtatur me ADR-002. Backend-i real i RRIT mbetet Nitro/TypeScript; nuk është krijuar backend i dytë Python. Ruff/type checker/pytest janë zëvendësuar sipas qëllimit të tyre me ESLint/Nuxt TypeScript/Vitest.

## Çfarë u implementua

- Node.js u fiksua në `24.20.0` dhe npm në `11.19.0` në manifestet, `.nvmrc`, Docker dhe CI.
- `.npmrc` aktivizon kontrollin strikt të engine-ve, lockfile-in dhe ruajtjen exact të varësive të reja.
- `package-lock.json` v3 u sinkronizua me manifestet.
- U shtua `toolchain:check`, i cili dështon nëse Node ose npm nuk kanë versionin e miratuar.
- U standardizuan `check` dhe `verify`; lokalisht dhe CI përdorin të njëjtat komanda.
- Testet u ndanë në `test:unit` pa DB dhe `test:integration` me PostgreSQL.
- Integration tests pranojnë vetëm `DATABASE_URL`/`MIGRATION_DATABASE_URL` lokale dhe refuzojnë Supabase v1 remote.
- Vitest u bë eksplicit determinist: UTC, pa file parallelism, pa retry/shuffle, mocks të pastruara dhe timeout-e fikse.
- U shtua pre-commit hook i versionuar dhe instalues cross-platform gjatë `npm ci`.
- Docker ka stage `quality`; production build nuk vazhdon pa clean install, toolchain, lint, typecheck dhe unit tests.
- Workflow-i CI kontrollon toolchain-in, ekzekuton quality gate-in e përbashkët dhe integration tests.
- README dhe dokumenti i dedikuar `docs/TOOLCHAIN.md` përshkruajnë përdorimin dhe upgrade policy-n.

## Evidenca e ekzekutuar

Në Docker clean-room me Node.js 24.20.0/npm 11.19.0:

- `npm ci`: kaloi nga lockfile, 991 paketa;
- toolchain check: kaloi;
- ESLint: kaloi;
- Nuxt typecheck: kaloi;
- unit tests: 24/24 kaluan;
- integration tests me PostgreSQL 18 të përkohshëm: 28/28 kaluan;
- production build: kaloi dhe u krijua image-i `rrit-s0-a03-validation`.

Nuk u përdorën kredenciale production dhe databaza e përkohshme nuk ruajti volume.

## Kriteret e pranimit

| Kriteri | Gjendja |
| --- | --- |
| Arkitektura Python→Nitro/TypeScript e vendosur me ADR | Plotësuar nga ADR-002 |
| Runtime dhe package manager të fiksuar | Plotësuar |
| Dependency lock/supply-chain baseline | Plotësuar |
| Lint/type/unit të njëjta lokalisht dhe në CI | Plotësuar në konfigurim dhe clean-room |
| Pre-commit | Plotësuar |
| Teste deterministe | Plotësuar |
| Fresh environment build | Plotësuar në Docker clean-room |
| Hosted CI run dhe reviewer sign-off | Pret ekzekutimin/miratimin në GitHub |

Kodi i task-ut nuk ka punë të mbetur. Për kalimin nga `In Review` në `Done`, Programmer B duhet të konfirmojë një run të gjelbër të workflow-it në GitHub dhe të regjistrojë RG-01/required branch check. Ky kontroll nuk simulohet ose deklarohet i kaluar lokalisht.
