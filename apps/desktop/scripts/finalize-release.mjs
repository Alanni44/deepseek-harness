/** Remove transient package-test output so a formal release has only updater assets. */

import { existsSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Keep exactly the updater assets belonging to one installer.
 * @param {{ releaseRoot: string, installerName: string }} options - release directory and expected installer name.
 */
export function finalizeRelease(options) {
  const permitted = new Set([options.installerName, `${options.installerName}.blockmap`, 'latest.yml'])
  for (const name of readdirSync(options.releaseRoot)) {
    if (permitted.has(name)) continue
    rmSync(join(options.releaseRoot, name), { recursive: true, force: true })
  }
  const actual = readdirSync(options.releaseRoot).sort()
  const expected = [...permitted].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`finalize-release: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
  }
}

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const releaseRoot = resolve(desktopRoot, 'release')
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const supplied = resolve(process.argv[2] ?? releaseRoot)
  if (supplied !== releaseRoot) throw new Error(`finalize-release: refusing to clean ${supplied}`)
  if (!existsSync(releaseRoot)) throw new Error(`finalize-release: release directory is missing: ${releaseRoot}`)
  const desktop = JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(join(desktopRoot, 'package.json'), 'utf8')))
  finalizeRelease({ releaseRoot, installerName: `DeepSeek Harness Setup ${desktop.version}.exe` })
  console.log('finalize-release: retained installer, blockmap, and latest.yml')
}
