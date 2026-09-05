/** Fail-closed inventory for the packaged Windows shell and backend closure. */

import { listPackage } from '@electron/asar'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const unpacked = resolve(process.argv[2] ?? join(desktopRoot, 'release', 'win-unpacked'))
const releaseRoot = dirname(unpacked)
const desktopPackage = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8'))
const installerName = `DeepSeek Harness Setup ${desktopPackage.version}.exe`

function requirePath(path) {
  if (!existsSync(path)) throw new Error(`verify-packaged-runtime: missing ${relative(unpacked, path)}`)
}

const asarPath = join(unpacked, 'resources', 'app.asar')
for (const path of [
  asarPath,
  join(unpacked, 'resources', 'app-update.yml'),
  join(unpacked, 'resources', 'node', 'node.exe'),
  join(unpacked, 'resources', 'backend', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  join(unpacked, 'resources', 'backend', 'THIRD_PARTY_NOTICES.txt'),
]) requirePath(path)

const asarEntries = listPackage(asarPath).map(entry => entry.replaceAll('\\', '/'))
for (const required of [
  '/lib/main/index.cjs',
  '/assets/loading.html',
  '/assets/loading.css',
  '/assets/loading.js',
  '/build/icon.png',
  '/build/tray-light.png',
  '/build/tray-dark.png',
  '/upstream.json',
]) {
  if (!asarEntries.includes(required)) throw new Error(`verify-packaged-runtime: app.asar missing ${required}`)
}
if (asarEntries.some(entry => entry.startsWith('/node_modules/@deepseek-ai/'))) {
  throw new Error('verify-packaged-runtime: app.asar duplicates the backend workspace closure')
}

const forbiddenArtifact = /(?:^|[\\/])(?:__tests__|examples?|tests?)(?:[\\/]|$)|\.map$|\.tsbuildinfo$/iu
const wrongPlatform = /(?:^|[\\/@_-])(?:darwin|freebsd|linux)-(?:arm64|x64)(?:[\\/@_.-]|$)/iu
function verifyTree(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const relativePath = relative(directory, path)
    if (forbiddenArtifact.test(path)) throw new Error(`verify-packaged-runtime: forbidden backend artifact ${path}`)
    if (wrongPlatform.test(path)) throw new Error(`verify-packaged-runtime: wrong-platform backend artifact ${path}`)
    if (entry.isDirectory()) verifyTree(path)
    else if (!entry.isFile() && !entry.isSymbolicLink()) {
      throw new Error(`verify-packaged-runtime: unsupported entry ${relativePath}`)
    }
  }
}
verifyTree(join(unpacked, 'resources', 'backend'))

const formalAssets = readdirSync(releaseRoot)
  .filter(name => name === 'latest.yml' || name.endsWith('.exe') || name.endsWith('.blockmap'))
  .sort()
const expectedAssets = [installerName, `${installerName}.blockmap`, 'latest.yml'].sort()
if (JSON.stringify(formalAssets) !== JSON.stringify(expectedAssets)) {
  throw new Error(`verify-packaged-runtime: formal assets ${JSON.stringify(formalAssets)} do not match ${JSON.stringify(expectedAssets)}`)
}
if (statSync(join(releaseRoot, installerName)).size === 0) throw new Error('verify-packaged-runtime: installer is empty')
console.log(`verify-packaged-runtime: ${asarEntries.length} ASAR entries; formal assets verified`)
