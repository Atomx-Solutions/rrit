import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

let prepared = false

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
    const fontDir = dirname(createRequire(import.meta.url).resolve('@expo-google-fonts/inter/package.json'))
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
