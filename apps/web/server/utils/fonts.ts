import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

let prepared = false

// Where the packaged font lives. In the bundled server import.meta.url points
// at the entry the bundler writes (a Vercel function reports /_entry.js), not
// at the installed packages, so the app's own folder is tried as well; both
// are tried in turn and the first that holds the package wins.
function resolveFontPackage() {
  const bases = [import.meta.url, pathToFileURL(join(process.cwd(), 'index.js')).href]
  let lastError: unknown
  for (const base of bases) {
    try {
      return createRequire(base).resolve('@expo-google-fonts/inter/package.json')
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

/**
 * Makes the Inter font packaged with the app known to fontconfig, which sharp
 * uses to draw the text on posters and video overlays. A Vercel function has
 * no fonts and no fontconfig file of its own, so every letter came out as a
 * box. The host's own fonts stay available when it has any, and a host that
 * names its own configuration in FONTCONFIG_FILE keeps it.
 */
export function prepareFonts() {
  if (prepared || process.env.FONTCONFIG_FILE) return
  prepared = true
  try {
    const fontDir = dirname(resolveFontPackage())
    const configDir = join(tmpdir(), 'rrit-fontconfig')
    mkdirSync(join(configDir, 'cache'), { recursive: true })
    const configFile = join(configDir, 'fonts.conf')
    writeFileSync(configFile, [
      '<?xml version="1.0"?>',
      '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">',
      '<fontconfig>',
      '  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>',
      `  <dir>${fontDir}</dir>`,
      `  <cachedir>${join(configDir, 'cache')}</cachedir>`,
      '</fontconfig>',
      '',
    ].join('\n'))
    process.env.FONTCONFIG_FILE = configFile
  } catch (error) {
    // Text then falls back on whatever the host has, as it did before.
    console.warn('The packaged font could not be made available to fontconfig', {
      error: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    })
  }
}
