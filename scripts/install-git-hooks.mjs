import { chmodSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const hook = new URL('../.githooks/pre-commit', import.meta.url)

// npm ci may run without a Git checkout (for example in a clean CI workspace).
// That environment must remain a successful no-op.
if (!existsSync(new URL('../.git', import.meta.url)) || !existsSync(hook)) {
  console.log('Git checkout not present; skipping local hook installation.')
  process.exit(0)
}

if (process.platform !== 'win32') chmodSync(hook, 0o755)

const result = spawnSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], {
  stdio: 'inherit',
  shell: false,
})

if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

console.log('Git pre-commit hook installed from .githooks/.')
