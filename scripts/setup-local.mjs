import { randomBytes } from 'node:crypto'
import { existsSync, writeFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const path = fileURLToPath(new URL('../.env', import.meta.url))
if (existsSync(path)) {
  let content = readFileSync(path, 'utf8').replace(/^NUXT_PUBLIC_DEMO_MODE=.*\r?\n?/gm, '')
  if (!/^AUTH_REQUIRE_EMAIL_VERIFICATION=/m.test(content))
    content += '\nAUTH_REQUIRE_EMAIL_VERIFICATION=false\n'
  for (const [key, size, encoding] of [
    ['RUNTIME_DB_PASSWORD', 24, 'hex'],
    ['TRIAL_HASH_KEY', 48, 'base64url'],
    ['META_TOKEN_KEY', 32, 'base64'],
    ['MEDIA_SIGNING_KEY', 48, 'base64url'],
  ]) {
    if (!new RegExp(`^${key}=.+$`, 'm').test(content))
      content += `\n${key}=${randomBytes(size).toString(encoding)}\n`
  }
  const ownerPassword = content.match(/^POSTGRES_PASSWORD=(.+)$/m)?.[1]
  const runtimePassword = content.match(/^RUNTIME_DB_PASSWORD=(.+)$/m)?.[1]
  if (ownerPassword && runtimePassword) {
    if (!/^MIGRATION_DATABASE_URL=/m.test(content))
      content += `\nMIGRATION_DATABASE_URL=postgresql://rrit:${ownerPassword}@127.0.0.1:15432/rrit\n`
    content = content.replace(
      /^DATABASE_URL=postgresql:\/\/rrit:[^\r\n]+@127\.0\.0\.1:15432\/rrit$/m,
      `DATABASE_URL=postgresql://rrit_runtime:${runtimePassword}@127.0.0.1:15432/rrit`,
    )
  }
  writeFileSync(path, content, { mode: 0o600 })
  console.log(
    'Preserved existing configuration; generated missing application keys and removed the demonstration flag.',
  )
} else {
  const password = randomBytes(24).toString('hex')
  const runtimePassword = randomBytes(24).toString('hex')
  writeFileSync(
    path,
    `POSTGRES_PASSWORD=${password}\nRUNTIME_DB_PASSWORD=${runtimePassword}\nMIGRATION_DATABASE_URL=postgresql://rrit:${password}@127.0.0.1:15432/rrit\nDATABASE_URL=postgresql://rrit_runtime:${runtimePassword}@127.0.0.1:15432/rrit\nBETTER_AUTH_SECRET=${randomBytes(48).toString('base64url')}\nBETTER_AUTH_URL=http://127.0.0.1:3000\nAUTH_REQUIRE_EMAIL_VERIFICATION=false\nSMTP_HOST=127.0.0.1\nSMTP_PORT=1029\nSMTP_FROM=Rrit <no-reply@rrit.local>\nTRIAL_HASH_KEY=${randomBytes(48).toString('base64url')}\nMETA_TOKEN_KEY=${randomBytes(32).toString('base64')}\nMEDIA_SIGNING_KEY=${randomBytes(48).toString('base64url')}\n`,
    { mode: 0o600, flag: 'wx' },
  )
  console.log('Created local .env with random credentials. No existing database was changed.')
}
