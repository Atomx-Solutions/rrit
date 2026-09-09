# RRIT runtime and quality toolchain

Status: Accepted baseline for S0-A03, 2026-09-08.

## Architecture mapping

The original backlog requested a Python 3.14/FastAPI toolchain. ADR-002 replaced that unimplemented backend with the production Nitro/TypeScript modular monolith. This baseline therefore preserves the task's operational and supply-chain outcomes with the tools used by the real backend:

| Original contract | Accepted RRIT equivalent |
| --- | --- |
| Python 3.14 runtime | Node.js 24.20.0 LTS |
| `pyproject` | root/workspace `package.json` manifests |
| Python dependency lock | npm lockfile v3 installed only with `npm ci` |
| Ruff | ESLint |
| Python type checker | Nuxt TypeScript typecheck in strict generated projects |
| pytest | Vitest unit/integration suites |
| pre-commit | versioned `.githooks/pre-commit` hook |

This mapping does not introduce a second Python backend and does not waive any security, tenancy, queue or release-gate requirement in the backlog.

## Pinned baseline

- `.nvmrc`, root `package.json`, the web workspace and both Docker stages require Node.js `24.20.0`.
- The root manifest requires npm `11.19.0`, the version shipped with that Node release.
- `.npmrc` rejects incompatible engines, requires the lockfile and saves future direct dependencies with exact versions.
- `package-lock.json` is the reviewed dependency graph. CI and production images use `npm ci`; `npm install` is reserved for intentional dependency updates followed by lockfile review.
- Docker references both the semantic Node version and an immutable image digest.
- The Docker `quality` stage performs a clean lockfile install, explicit Nuxt preparation and the same `npm run check` gate before the production build stage can run.

Runtime upgrades are deliberate changes: update every pin together, regenerate the lock with the selected npm version, review dependency/audit diffs and repeat the clean-room evidence below.

## Reproducible commands

From the repository root:

```sh
npm ci
npm run check
npm run verify
```

`check` validates the exact Node/npm pair, then runs ESLint, Nuxt typechecking and database-independent unit tests. `verify` additionally runs PostgreSQL integration tests and the production Nuxt build. Git installs the versioned pre-commit hook during `npm ci`; the hook runs `npm run check` and blocks a commit on any failure. CI invokes the same commands rather than maintaining a separate quality policy.

Integration-test safety is explicit: the suite accepts only `DATABASE_URL` or `MIGRATION_DATABASE_URL` pointing to `localhost` or `127.0.0.1`. Remote Supabase URLs are rejected. The Supabase v1 environment in `.env` must therefore never be used for destructive integration tests.

Vitest uses UTC, fixed file ordering, no file parallelism, no retries, cleared/restored mocks and explicit timeouts. Tests must not depend on wall-clock time, network services not provisioned by the suite, execution order or shared mutable state.

## Clean-room acceptance procedure

S0-A03 is accepted only with evidence from a clean checkout or clean container using no pre-existing `node_modules`:

1. Confirm `node --version` is `v24.20.0` and `npm --version` is `11.19.0`.
2. Run `npm ci`; any manifest/lock mismatch must fail.
3. Run `npm run check`, provision the local PostgreSQL test service, then run `npm run test:integration` and `npm run build`.
4. In CI, confirm the same commands pass on the checked-in lockfile.
5. Record command versions, exit codes, test totals and build result in `docs/VALIDATION.md` without secrets.

Hosted branch protection and organization-level approval remain repository-administration controls. The checked-in workflow supplies the reproducible RG-01 checks; a maintainer must mark them required in GitHub before a protected production release.
