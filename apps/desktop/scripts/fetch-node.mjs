/**
 * Fetch a self-contained Node runtime for the packaged backend. The desktop
 * shell spawns the dsh backend under a real Node, so the packaged exe must
 * carry one instead of requiring `node` on PATH. Downloads the official win-x64
 * zip (npmmirror mirror first, nodejs.org fallback) and keeps only `node.exe`.
 *
 * Usage: `node scripts/fetch-node.mjs` (run by the `dist` script before
 * electron-builder). `DSH_DESKTOP_NODE_VERSION` overrides the version; it must
 * match the ABI the workspace's native modules (node-pty, koffi) were built
 * against.
 * @module @deepseek-ai/dsh-desktop/fetch-node
 */

import { copyFileSync, createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VERSION = process.env.DSH_DESKTOP_NODE_VERSION ?? 'v24.15.0'
const OUT_DIR = join(ROOT, 'build', 'node')
const OUT_EXE = join(OUT_DIR, 'node.exe')

const URLS = [
  `https://npmmirror.com/mirrors/node/${VERSION}/node-${VERSION}-win-x64.zip`,
  `https://nodejs.org/dist/${VERSION}/node-${VERSION}-win-x64.zip`,
]

/**
 * Download and keep only the self-contained node.exe from one of the mirrors.
 * @returns nothing; throws when no mirror yields the archive.
 */
async function main() {
  if (existsSync(OUT_EXE)) {
    console.log(`fetch-node: ${OUT_EXE} already present`)
    return
  }
  mkdirSync(OUT_DIR, { recursive: true })
  const tmpZip = join(OUT_DIR, `node-${VERSION}-win-x64.zip`)
  let lastError
  for (const url of URLS) {
    try {
      rmSync(tmpZip, { force: true })
      console.log(`fetch-node: downloading ${url}`)
      const response = await fetch(url)
      if (!response.ok || response.body === null) throw new Error(`HTTP ${response.status}`)
      await pipeline(response.body, createWriteStream(tmpZip))
      break
    } catch (error) {
      lastError = error
      console.error(`fetch-node: ${url} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (!existsSync(tmpZip)) {
    throw new Error(`fetch-node: could not download node ${VERSION}: ${String(lastError)}`)
  }
  // Expand-Archive is Windows-only, matching the win-x64 runtime this script
  // fetches. Node's official win-x64 node.exe is self-contained (static ICU,
  // V8, libuv), so the extracted exe alone runs the backend.
  const extracted = join(OUT_DIR, `node-${VERSION}-win-x64`)
  rmSync(extracted, { recursive: true, force: true })
  execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path '${tmpZip}' -DestinationPath '${OUT_DIR}' -Force`], { stdio: 'inherit' })
  copyFileSync(join(extracted, 'node.exe'), OUT_EXE)
  rmSync(extracted, { recursive: true, force: true })
  rmSync(tmpZip, { force: true })
  console.log(`fetch-node: wrote ${OUT_EXE}`)
}

await main()
