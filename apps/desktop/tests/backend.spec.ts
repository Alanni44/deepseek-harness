import { describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveBackendNode, resolveDshBin, startBackend } from '../src/main/backend.ts'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

function fixture(name: string): string {
  return join(FIXTURES, name)
}

describe('resolveBackendNode', () => {
  it('prefers the explicit override over bundled and pnpm node', () => {
    expect(resolveBackendNode({ DSH_DESKTOP_NODE: '/opt/node', npm_node_execpath: '/pnpm/node' }, '/bundled/node.exe'))
      .toBe('/opt/node')
  })

  it('prefers the bundled node over pnpm node when present', () => {
    expect(resolveBackendNode({ npm_node_execpath: '/pnpm/node' }, '/bundled/node.exe')).toBe('/bundled/node.exe')
  })

  it('falls back to pnpm node, then node from PATH', () => {
    expect(resolveBackendNode({ npm_node_execpath: '/pnpm/node' })).toBe('/pnpm/node')
    expect(resolveBackendNode({})).toBe('node')
  })
})

describe('resolveDshBin', () => {
  it('resolves the built CLI entry beside the dsh package', () => {
    const resolvePkgJson = (specifier: string): string => {
      expect(specifier).toBe('@deepseek-ai/dsh/package.json')
      return '/app/node_modules/@deepseek-ai/dsh/package.json'
    }
    expect(resolveDshBin(resolvePkgJson))
      .toBe(join('/app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
  })
})

describe('startBackend', () => {
  it('starts from the deployed backend root', async () => {
    const startupOutput: string[] = []
    const backend = startBackend({
      node: process.execPath,
      bin: fixture('backend-cwd.mjs'),
      cwd: FIXTURES,
      port: 0,
      readinessTimeoutMs: 1_000,
      onStartupOutput: (chunk) => { startupOutput.push(chunk) },
    })

    await backend.ready
    expect(startupOutput.join('')).toContain(`cwd:${FIXTURES}`)
    await backend.stop()
  })

  it('resolves the first readiness URL and stops without retaining post-readiness output', async () => {
    const startupOutput: string[] = []
    const backend = startBackend({
      node: process.execPath,
      bin: fixture('backend-ready.mjs'),
      port: 0,
      readinessTimeoutMs: 1_000,
      stopGraceMs: 1_000,
      onStartupOutput: (chunk) => { startupOutput.push(chunk) },
    })

    await expect(backend.ready).resolves.toBe('http://127.0.0.1:43123')
    await new Promise(resolve => setTimeout(resolve, 75))
    expect(startupOutput.join('')).not.toContain('private-after-ready')
    const exit = await backend.stop()
    expect(exit.requested).toBe(true)
    await expect(backend.done).resolves.toEqual(exit)
  })

  it('rejects readiness after the configured deadline', async () => {
    const backend = startBackend({
      node: process.execPath,
      bin: fixture('backend-hang.mjs'),
      port: 0,
      readinessTimeoutMs: 50,
      stopGraceMs: 1_000,
    })

    const outcome = await Promise.race([
      backend.ready.then(
        value => ({ value }),
        (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }),
      ),
      new Promise<{ timedOut: true }>(resolve => setTimeout(() => { resolve({ timedOut: true }) }, 250)),
    ])
    expect(outcome).toEqual({ error: 'dsh desktop backend was not ready within 50 ms' })
    await backend.stop()
  })

  it('reports an early process exit independently from readiness', async () => {
    const backend = startBackend({
      node: process.execPath,
      bin: fixture('backend-exit.mjs'),
      port: 0,
      readinessTimeoutMs: 1_000,
    })

    await expect(backend.ready).rejects.toThrow('exited before readiness (code 17)')
    await expect(backend.done).resolves.toEqual({ code: 17, signal: null, requested: false })
  })
})
