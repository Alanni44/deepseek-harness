import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const DESKTOP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function readRecord(path: string): Record<string, unknown> {
  const value: unknown = parse(readFileSync(path, 'utf8'))
  if (typeof value !== 'object' || value === null) throw new Error(`${path} is not an object`)
  return value as Record<string, unknown>
}

describe('desktop packaging contract', () => {
  it('uses injected workspace packages so deploy includes the complete runtime closure', () => {
    const deployScript = readFileSync(join(DESKTOP_ROOT, 'scripts', 'prepare-backend.mjs'), 'utf8')
    expect(deployScript).toContain("'--config.inject-workspace-packages=true'")
    expect(deployScript).toContain("'--config.node-linker=hoisted'")
    expect(deployScript).toContain("'--config.verify-deps-before-run=false'")
    expect(deployScript).not.toContain("'--legacy'")
  })

  it('builds one NSIS target with ASAR and deployed backend resources', () => {
    const config = readRecord(join(DESKTOP_ROOT, 'electron-builder.yml'))
    const win = config.win as Record<string, unknown>
    expect(config.asar).toBe(true)
    expect(win.target).toEqual(['nsis'])
    expect(config.extraResources).toEqual(expect.arrayContaining([
      { from: 'build/node', to: 'node' },
    ]))
    expect(config.afterPack).toBe('scripts/copy-backend-after-pack.cjs')
    expect(JSON.stringify(config)).not.toContain('portable')
  })

  it('ships the thin shell assets without a duplicate node_modules closure', () => {
    const config = readRecord(join(DESKTOP_ROOT, 'electron-builder.yml'))
    expect(config.files).toEqual(expect.arrayContaining([
      'lib/main/index.cjs',
      'assets/loading.html',
      'assets/loading.css',
      'assets/loading.js',
      'build/icon.png',
      'build/tray-light.png',
      'build/tray-dark.png',
      '!node_modules/**',
    ]))
  })

  it('defines fail-closed runtime, smoke, footprint, and icon verification commands', () => {
    const pkg: unknown = JSON.parse(readFileSync(join(DESKTOP_ROOT, 'package.json'), 'utf8'))
    if (typeof pkg !== 'object' || pkg === null) throw new Error('desktop package is invalid')
    const scripts = (pkg as { scripts: Record<string, string> }).scripts
    expect(scripts['prepare-backend']).toContain('prepare-backend.mjs')
    expect(scripts['verify:package']).toContain('verify-packaged-runtime.mjs')
    expect(scripts['smoke:package']).toContain('smoke-packaged-backend.mjs')
    expect(scripts.footprint).toContain('measure-footprint.mjs')
    for (const script of [
      'prepare-backend.mjs',
      'generate-notices.mjs',
      'verify-packaged-runtime.mjs',
      'smoke-packaged-backend.mjs',
      'measure-footprint.mjs',
      'verify-windows-icons.ps1',
    ]) expect(existsSync(join(DESKTOP_ROOT, 'scripts', script))).toBe(true)
  })

  it('keeps an attainable unpacked footprint reduction budget', () => {
    const baseline = JSON.parse(readFileSync(join(DESKTOP_ROOT, 'footprint-baseline.json'), 'utf8')) as {
      minimumUnpackedReductionBytes?: unknown
    }
    expect(baseline.minimumUnpackedReductionBytes).toBe(12 * 1024 * 1024)
  })

})
