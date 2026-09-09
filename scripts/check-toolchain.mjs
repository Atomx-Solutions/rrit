import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const expectedNode = readFileSync(new URL('../.nvmrc', import.meta.url), 'utf8').trim().replace(/^v/, '')
const expectedNpm = manifest.packageManager?.match(/^npm@(.+)$/)?.[1] ?? manifest.engines?.npm
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npmRunner = process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : npmExecutable
const npmArgs = process.platform === 'win32' ? ['/d', '/s', '/c', `${npmExecutable} --version`] : ['--version']

if (!expectedNode || !expectedNpm) {
  console.error('Unable to determine the pinned Node.js/npm versions from .nvmrc and package.json.')
  process.exit(1)
}

let actualNpm
try {
  actualNpm = execFileSync(npmRunner, npmArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim()
} catch {
  console.error('Unable to execute npm. Install the pinned Node.js distribution and retry.')
  process.exit(1)
}

const failures = []
if (manifest.engines?.node !== expectedNode)
  failures.push(`package.json Node.js engine must match .nvmrc (${expectedNode}); found ${manifest.engines?.node ?? 'missing'}.`)
if (manifest.engines?.npm !== expectedNpm)
  failures.push(`package.json npm engine must match packageManager (${expectedNpm}); found ${manifest.engines?.npm ?? 'missing'}.`)
if (process.versions.node !== expectedNode)
  failures.push(`Node.js ${expectedNode} required; found ${process.versions.node}.`)
if (actualNpm !== expectedNpm)
  failures.push(`npm ${expectedNpm} required; found ${actualNpm}.`)

if (failures.length > 0) {
  console.error(failures.join('\n'))
  console.error('Use the versions declared in .nvmrc and package.json.')
  process.exit(1)
}

console.log(`Toolchain verified: Node.js ${process.versions.node}, npm ${actualNpm}.`)
