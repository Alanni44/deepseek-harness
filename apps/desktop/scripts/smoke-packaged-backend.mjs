/** Start the shipped CLI with the shipped Node and prove its loopback HTTP UI. */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findPackagedReadyUrl } from './smoke-readiness.mjs'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const unpacked = resolve(process.argv[2] ?? join(desktopRoot, 'release', 'win-unpacked'))
const resources = join(unpacked, 'resources')
const node = join(resources, 'node', 'node.exe')
const backend = join(resources, 'backend')
const bin = join(backend, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
if (!existsSync(node) || !existsSync(bin)) throw new Error('smoke-packaged-backend: packaged Node or CLI is missing')

const isolatedHome = mkdtempSync(join(tmpdir(), 'dsh-desktop-smoke-'))
const child = spawn(node, [bin, 'web', '--port', '0'], {
  cwd: backend,
  env: { ...process.env, DSH_HOME: isolatedHome },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
let settled = false

const ready = new Promise((resolveReady, rejectReady) => {
  const timeout = setTimeout(() => rejectReady(new Error(`backend readiness timed out\n${output}`)), 90_000)
  const inspect = (chunk) => {
    output = `${output}${chunk.toString()}`.slice(-64 * 1024)
    const url = findPackagedReadyUrl(output)
    if (url !== undefined && !settled) {
      settled = true
      clearTimeout(timeout)
      resolveReady(url)
    }
  }
  child.stdout.on('data', inspect)
  child.stderr.on('data', inspect)
  child.once('error', (error) => { clearTimeout(timeout); rejectReady(error) })
  child.once('exit', (code) => {
    if (!settled) {
      clearTimeout(timeout)
      rejectReady(new Error(`backend exited before readiness (${String(code)})\n${output}`))
    }
  })
})

async function stop() {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise(resolveExit => child.once('exit', resolveExit)),
    new Promise(resolveTimeout => setTimeout(resolveTimeout, 5_000)),
  ])
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
}

try {
  const url = await ready
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  const body = await response.text()
  if (!response.ok || body.length === 0) throw new Error(`smoke-packaged-backend: HTTP ${response.status} with empty UI`)
  const result = { url, status: response.status, responseBytes: Buffer.byteLength(body), checkedAt: new Date().toISOString() }
  writeFileSync(join(desktopRoot, 'build', 'smoke-packaged-backend.json'), `${JSON.stringify(result, null, 2)}\n`)
  console.log(`smoke-packaged-backend: ${url} returned ${response.status} (${result.responseBytes} bytes)`)
} finally {
  await stop()
  rmSync(isolatedHome, { recursive: true, force: true })
}
